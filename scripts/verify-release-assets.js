const { parseArgs } = require('node:util');

const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function verifyReleaseAssets({ version, assets }) {
  if (typeof version !== 'string' || !EXACT_VERSION.test(version)) {
    throw new Error('version must be an exact X.Y.Z version');
  }
  if (!Array.isArray(assets) || assets.some((asset) => typeof asset !== 'string')) {
    throw new Error('assets must be an array of names');
  }
  const installer = `Pi-Desktop-Setup-${version}.exe`;
  const expected = [installer, `${installer}.blockmap`, 'latest.yml'];
  const missing = expected.filter((asset) => !assets.includes(asset));
  const seen = new Set();
  const unexpected = assets.filter((asset) => !expected.includes(asset) || seen.has(asset) ? true : !seen.add(asset));

  return missing.length === 0 && unexpected.length === 0
    ? { ok: true, missing: [] }
    : { ok: false, missing, unexpected };
}

module.exports = { verifyReleaseAssets };

if (require.main === module) {
  try {
    const { values } = parseArgs({
      options: {
        version: { type: 'string' },
        asset: { type: 'string', multiple: true, default: [] },
      },
      strict: true,
      allowPositionals: false,
    });
    const result = verifyReleaseAssets({ version: values.version, assets: values.asset });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`[verify-release-assets] ${error.message}`);
    process.exitCode = 2;
  }
}
