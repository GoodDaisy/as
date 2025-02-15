import { Parser, Source } from 'assemblyscript/dist/assemblyscript.js';
import assert from 'assert';
import { readFileSync } from 'fs';

export function parseFile(filePath: string, parser: Parser): Source {
  const isNodeModule = filePath.includes('node_modules/');

  if (isNodeModule) {
    const shortFilePath = filePath.replace(/.*node_modules/i, '~lib');
    parser.parseFile(readFileSync(filePath, 'utf-8'), shortFilePath, false);
  } else {
    const shortFilePath = filePath.replace(process.cwd() + '/', '');
    parser.parseFile(
      readFileSync(shortFilePath, 'utf-8'),
      shortFilePath.replace('build/', 'assembly/contracts/'),
      false,
    );
  }
  for (let diag of parser.diagnostics) {
    // eslint-disable-next-line no-console
    console.warn(
      `Massa Transform error:\n msg:'${diag.message}'\nfrom: ${diag.range?.source.internalPath}:${diag.range?.start}`,
    );
  }
  assert(
    parser.diagnostics.length <= 0,
    'There were some errors with the parsing of new sources in as-transformer (see above).',
  );

  const src = parser.sources.pop();

  assert(
    src !== undefined,
    `Source is undefined after parsing file ${filePath}`,
  );
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return src!;
}
