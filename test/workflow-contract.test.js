const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'auto-update.yml');
const source = fs.readFileSync(workflowPath, 'utf8');
const workflow = YAML.parse(source);
const steps = workflow.jobs.release.steps;

function step(name) {
  return steps.find((item) => item.name === name);
}

test('release lookup steps target the current repo and tolerate an expected miss', () => {
  for (const name of [
    'Prepare candidate and inspect matching Release',
    'Create or reset draft Release',
  ]) {
    const run = step(name)?.run;
    assert.equal(typeof run, 'string', `missing workflow step: ${name}`);
    assert.match(run, /gh release view[^\r\n]*--repo \$\{\{ github\.repository \}\}/);
    assert.match(run, /try\s*\{\s*\r?\n\s*(?:\$release = )?gh release view[^\r\n]*2>\$null\s*\r?\n\s*\}\s*catch\s*\{/);
    assert.match(run, /\$LASTEXITCODE/);
  }
});

test('mutating release commands remain outside tolerated lookup failures', () => {
  const run = step('Create or reset draft Release')?.run;
  assert.match(run, /gh release edit/);
  assert.match(run, /gh release create/);
  assert.doesNotMatch(run, /try\s*\{[\s\S]*gh release (?:edit|create)[\s\S]*\}\s*catch/);
});
