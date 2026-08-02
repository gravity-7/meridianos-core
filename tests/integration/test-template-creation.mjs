import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TemplateLoader } from '../../control-plane.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'templates');
const TEST_PROJECT_ROOT = path.join(__dirname, '.test-template-project');

describe('Template-Based Project Creation', () => {
  let templateLoader;

  before(() => {
    templateLoader = new TemplateLoader(TEMPLATES_DIR);
    if (fs.existsSync(TEST_PROJECT_ROOT)) {
      fs.rmSync(TEST_PROJECT_ROOT, { recursive: true, force: true });
    }
  });

  after(() => {
    if (fs.existsSync(TEST_PROJECT_ROOT)) {
      fs.rmSync(TEST_PROJECT_ROOT, { recursive: true, force: true });
    }
  });

  it('T124 should apply a template to a project directory', () => {
    templateLoader.apply('cli-tool', TEST_PROJECT_ROOT);
    
    // Verify directories were created
    assert.ok(fs.existsSync(TEST_PROJECT_ROOT), 'Project root should exist');
    assert.ok(fs.existsSync(path.join(TEST_PROJECT_ROOT, '.ai')), '.ai directory should exist');
    
    // Verify policy.yaml was created and populated
    const policyPath = path.join(TEST_PROJECT_ROOT, '.ai', 'policy.yaml');
    assert.ok(fs.existsSync(policyPath), 'policy.yaml should exist');
    
    const policyContent = fs.readFileSync(policyPath, 'utf8');
    assert.ok(policyContent.includes('agents:'), 'policy.yaml should contain agents configuration');
    assert.ok(policyContent.includes('taskCategories:'), 'policy.yaml should contain taskCategories configuration');
    assert.ok(policyContent.includes('builder'), 'policy.yaml should contain builder agent');
  });
});
