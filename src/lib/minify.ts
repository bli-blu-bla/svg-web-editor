import { optimize } from 'svgo/browser';

export interface MinifyOpts { precision: number; multipass: boolean; keepIds: boolean; pretty: boolean }

export function minify(svg: string, o: MinifyOpts): string {
  const res = optimize(svg, {
    multipass: o.multipass,
    floatPrecision: o.precision,
    js2svg: { pretty: o.pretty, indent: 2 },
    plugins: [
      {
        name: 'preset-default',
        params: {
          overrides: {
            ...(o.keepIds ? { cleanupIds: false } : {}),
          },
        },
      },
    ],
  });
  return res.data;
}

export const byteSize = (s: string) => new Blob([s]).size;
export const fmtBytes = (b: number) => (b < 1024 ? `${b} B` : `${(b / 1024).toFixed(2)} KB`);
