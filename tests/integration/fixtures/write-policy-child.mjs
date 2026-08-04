/**
 * Fixture process for the "concurrent config changes" edge-case test
 * (tests/integration/test-edge-cases.mjs). Run as a standalone Node process so two invocations
 * against the SAME policy.yaml file race at the real OS filesystem level — something a single
 * process can't simulate, since writePolicy itself never yields to the event loop.
 *
 * Usage: node write-policy-child.mjs <policyPath> <dottedPath> <value>
 */
import { writePolicy } from '../../../policy-write.mjs';

const [, , policyPath, dottedPath, rawValue] = process.argv;
const value = rawValue === 'true' ? true : rawValue === 'false' ? false : Number.isNaN(Number(rawValue)) ? rawValue : Number(rawValue);

try {
  writePolicy({ [dottedPath]: value }, { path: policyPath });
  process.exit(0);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
