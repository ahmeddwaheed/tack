import { Crepe, type CrepeConfig } from "@milkdown/crepe";
import { remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import type { Options } from "remark-stringify";
import { calloutPlugins, stringifyCalloutMarker } from "./plugins/callout";
import { rawBlockPlugins, stringifyRawBlock } from "./plugins/rawBlock";
import { stringifyText } from "./plugins/text";
import { stringifyWikilink, wikilinkPlugins } from "./plugins/wikilink";

export const tackStringifyOptions = {
  bullet: "-",
  rule: "-",
  handlers: {
    text: stringifyText,
    tackWikilink: stringifyWikilink,
    tackCalloutMarker: stringifyCalloutMarker,
    tackRawBlock: stringifyRawBlock,
  },
} satisfies Options;

const tackStringify: MilkdownPlugin = (ctx) => {
  ctx.update(remarkStringifyOptionsCtx, (prev) => ({
    ...prev,
    ...tackStringifyOptions,
    handlers: { ...prev.handlers, ...tackStringifyOptions.handlers },
  }));
  return async () => {};
};

export const tackEditorPlugins: MilkdownPlugin[] = [
  tackStringify,
  ...rawBlockPlugins,
  ...calloutPlugins,
  ...wikilinkPlugins,
];

export const tackCrepeFeatures: CrepeConfig["features"] = {
  // Crepe's image block writes its resize ratio into the alt text, which loses the original alt.
  [Crepe.Feature.ImageBlock]: false,
  [Crepe.Feature.TopBar]: false,
  [Crepe.Feature.AI]: false,
};

export function createTackCrepe(
  config: Omit<CrepeConfig, "features">,
  extraPlugins: MilkdownPlugin[] = [],
): Crepe {
  const crepe = new Crepe({ ...config, features: tackCrepeFeatures });
  crepe.editor.use(tackEditorPlugins).use(extraPlugins);
  return crepe;
}

export async function roundTripBody(body: string): Promise<string> {
  const crepe = createTackCrepe({ root: document.createElement("div"), defaultValue: body });
  await crepe.create();
  try {
    return crepe.getMarkdown();
  } finally {
    await crepe.destroy();
  }
}
