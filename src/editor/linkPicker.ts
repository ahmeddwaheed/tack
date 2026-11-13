import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { wikilinkSchema } from "../markdown/plugins/wikilink";

export type TitleSearch = (query: string) => string[];

interface Trigger {
  from: number;
  to: number;
  query: string;
}

interface PickerState {
  trigger: Trigger | null;
  dismissed: number | null;
}

const MAX_OPTIONS = 8;
const OPEN_LINK = /\[\[([^[\]\n￼]*)$/;
const DISMISS = "dismiss";

const pickerKey = new PluginKey<PickerState>("tackLinkPicker");

function findTrigger(state: EditorState): Trigger | null {
  const { empty, $from } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return null;
  if ($from.marks().some((mark) => mark.type.spec.code)) return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
  const match = OPEN_LINK.exec(before);
  if (!match) return null;
  if (before[match.index - 1] === "!") return null;
  if ((before.slice(0, match.index).match(/`/g)?.length ?? 0) % 2 === 1) return null;
  return { from: $from.pos - match[0].length, to: $from.pos, query: match[1] ?? "" };
}

const activeTrigger = (state: EditorState): Trigger | null => {
  const picker = pickerKey.getState(state);
  if (!picker?.trigger || picker.trigger.from === picker.dismissed) return null;
  return picker.trigger;
};

const linkable = (title: string) => !/[[\]]/.test(title);

class PickerView {
  readonly dom = document.createElement("div");
  private titles: string[] = [];
  private selected = 0;
  private query: string | null = null;

  constructor(
    private readonly view: EditorView,
    private readonly searchTitles: TitleSearch,
    private readonly insert: (view: EditorView, trigger: Trigger, title: string) => void,
  ) {
    this.dom.className = "tack-link-picker";
    this.dom.setAttribute("role", "listbox");
    this.dom.hidden = true;
    this.dom.addEventListener("mousedown", (event) => {
      const option = (event.target as HTMLElement).closest<HTMLElement>("[data-index]");
      if (!option) return;
      event.preventDefault();
      this.choose(Number(option.dataset.index));
    });
    document.body.append(this.dom);
    this.update();
  }

  get visible() {
    return !this.dom.hidden;
  }

  update() {
    const trigger = activeTrigger(this.view.state);
    if (!trigger) return this.hide();
    if (trigger.query !== this.query) {
      this.query = trigger.query;
      this.selected = 0;
      this.titles = this.searchTitles(trigger.query).filter(linkable).slice(0, MAX_OPTIONS);
    }
    if (this.titles.length === 0) return this.hide();
    this.render();
    this.position(trigger.from);
  }

  move(step: number) {
    this.selected = (this.selected + step + this.titles.length) % this.titles.length;
    this.render();
  }

  choose(index = this.selected) {
    const trigger = activeTrigger(this.view.state);
    const title = this.titles[index];
    if (!trigger || title === undefined) return;
    this.insert(this.view, trigger, title);
  }

  destroy() {
    this.dom.remove();
  }

  private hide() {
    this.dom.hidden = true;
    this.query = null;
  }

  private render() {
    this.dom.replaceChildren(
      ...this.titles.map((title, index) => {
        const option = document.createElement("div");
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === this.selected));
        option.dataset.index = String(index);
        option.textContent = title;
        return option;
      }),
    );
    this.dom.hidden = false;
  }

  private position(pos: number) {
    try {
      const coords = this.view.coordsAtPos(pos);
      this.dom.style.left = `${coords.left}px`;
      this.dom.style.top = `${coords.bottom + 4}px`;
    } catch {
      return;
    }
  }
}

export function linkPicker(searchTitles: TitleSearch): MilkdownPlugin[] {
  const plugin = $prose((ctx) => {
    let picker: PickerView | null = null;
    const insert = (view: EditorView, trigger: Trigger, title: string) => {
      const node = wikilinkSchema.type(ctx).create({ value: `[[${title}]]` });
      view.dispatch(view.state.tr.replaceWith(trigger.from, trigger.to, node).scrollIntoView());
    };
    return new Plugin<PickerState>({
      key: pickerKey,
      state: {
        init: (_, state) => ({ trigger: findTrigger(state), dismissed: null }),
        apply: (tr, previous, _, state) => {
          const trigger = findTrigger(state);
          if (tr.getMeta(pickerKey) === DISMISS) return { trigger, dismissed: trigger?.from ?? null };
          const mapped = previous.dismissed === null ? null : tr.mapping.map(previous.dismissed);
          return { trigger, dismissed: trigger && mapped === trigger.from ? mapped : null };
        },
      },
      view: (view) => {
        picker = new PickerView(view, searchTitles, insert);
        return {
          update: () => picker?.update(),
          destroy: () => {
            picker?.destroy();
            picker = null;
          },
        };
      },
      props: {
        handleKeyDown: (view, event) => {
          if (!picker?.visible) return false;
          switch (event.key) {
            case "ArrowDown":
              picker.move(1);
              return true;
            case "ArrowUp":
              picker.move(-1);
              return true;
            case "Enter":
            case "Tab":
              picker.choose();
              return true;
            case "Escape":
              view.dispatch(view.state.tr.setMeta(pickerKey, DISMISS));
              return true;
            default:
              return false;
          }
        },
      },
    });
  });
  return [plugin];
}
