const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const indexSource = fs.readFileSync(
  path.join(root, 'index.js'),
  'utf8'
);

const controllerSource = fs.readFileSync(
  path.join(root, 'controllers', 'sessionController.js'),
  'utf8'
);

const cleanupSource = fs.readFileSync(
  path.join(root, 'jobs', 'cleanup.js'),
  'utf8'
);

describe('setup/session lifecycle authority boundary', () => {
  test('established-session lifecycle does not use legacy table-only setup clear helper', () => {
    expect(indexSource).not.toMatch(
      /function\s+clearSetupLockForTable\s*\(\s*tableToken\s*\)/
    );

    expect(indexSource).not.toMatch(
      /clearSetupLockForTable\s*\(\s*row\.table_token\s*\)/
    );

    expect(indexSource).not.toMatch(
      /clearSetupLockForTable\s*\(\s*tf\.table_token\s*\)/
    );
  });

  test('legacy createSession setup completion cannot bypass scoped credential protocol', () => {
    expect(controllerSource).not.toMatch(
      /io\.to\s*\(\s*`setup_\$\{table_token\}`\s*\)\.emit\s*\(\s*['"]setup_completed['"]/
    );

    expect(controllerSource).not.toMatch(
      /setup_completed[\s\S]{0,300}\bsessionId\b/
    );

    expect(controllerSource).not.toMatch(
      /setup_completed[\s\S]{0,300}\bsessionGroupId\b/
    );
  });
  test('HTTP Fresh termination cannot release setup arbitration', () => {
    expect(controllerSource).not.toMatch(
      /clearSetupLockForTable\s*\(\s*table_token\s*\)/
    );

    expect(controllerSource).not.toMatch(
      /io\.to\s*\(\s*`setup_\$\{table_token\}`\s*\)\.emit\s*\(\s*['"]setup_released['"]/
    );
  });

  test('cleanup termination cannot release setup arbitration', () => {
    expect(cleanupSource).not.toMatch(
      /clearSetupLockForTable/
    );
  });

  test('credential-protected setup release remains in setup subsystem', () => {
    expect(indexSource).toMatch(
      /socket\.on\s*\(\s*['"]release_setup['"]/
    );

    expect(indexSource).toMatch(
      /current\.lockToken\s*!==\s*lockToken/
    );

    expect(indexSource).toMatch(
      /socket\.on\s*\(\s*['"]setup_completed['"]/
    );
  });

  test('setup namespace remains tenant plus table scoped', () => {
    expect(indexSource).toMatch(
      /restaurantSlug\.trim\(\)\.toLowerCase\(\)\s*\+\s*['"]::['"]\s*\+\s*tableToken/
    );
  });
});