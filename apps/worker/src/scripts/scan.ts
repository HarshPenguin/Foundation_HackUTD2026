// Usage: tsx src/scripts/scan.ts <folder>  (prints the Auditor's report for a local checkout)
import { auditMarkdown, scanRepo } from '../scanner';
const dir = process.argv[2];
if (!dir) throw new Error('pass a folder');
const r = scanRepo(dir);
console.log(auditMarkdown(dir.split('/').pop() ?? 'app', 'local', 'local', r));
