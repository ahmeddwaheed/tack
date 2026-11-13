export type Pending<T> = T & { resolve(ok: boolean): void };

export function confirmSlot<T extends object>(show: (request: Pending<T> | null) => void) {
  let pending: ((ok: boolean) => void) | null = null;
  return (request: T) =>
    new Promise<boolean>((resolve) => {
      pending?.(false);
      const settle = (ok: boolean) => {
        if (pending !== settle) {
          resolve(false);
          return;
        }
        pending = null;
        show(null);
        resolve(ok);
      };
      pending = settle;
      show({ ...request, resolve: settle });
    });
}
