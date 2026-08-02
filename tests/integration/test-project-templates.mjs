import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TemplateLoader, getTemplateLoader } from '../../control-plane.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'templates');

describe('Project Templates Integration Tests', () => {
  let templateLoader;

  before(() => {
    templateLoader = new TemplateLoader(TEMPLATES_DIR);
  });

  it('T123 should list available templates', () => {
    const templates = templateLoader.list();
    assert.ok(Array.isArray(templates), 'list() should return an array');
    assert.ok(templates.length >= 7, 'Should have at least 7 default templates');
    
    const saasTemplate = templates.find(t => t.id === 'saas-web-app');
    assert.ok(saasTemplate, 'Should contain saas-web-app template');
    assert.equal(saasTemplate.name, 'Saas Web App', 'Should properly format name');
    assert.ok(saasTemplate.agentCount >= 3, 'saas-web-app should have at least 3 agents');
    assert.ok(saasTemplate.categoryCount >= 7, 'saas-web-app should have at least 7 task categories');
  });

  it('T123 should load and validate a template', () => {
    const template = templateLoader.load('mobile-app');
    assert.ok(template, 'Should load template content');
    assert.ok(template.agents, 'Template should contain agents');
    assert.ok(template.taskCategories, 'Template should contain taskCategories');
    assert.ok(template.agents.builder, 'Should have builder agent');
  });

  it('T123 should throw when loading a non-existent template', () => {
    assert.throws(() => {
      templateLoader.load('non-existent-template-1234');
    }, /Template not found/);
  });
});
