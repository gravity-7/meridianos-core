// Quick API test — creates one test Feature to verify ADO connectivity
const pat = process.env.ADO_PAT;
if (!pat) { console.error('set ADO_PAT'); process.exit(1); }

const auth = 'Basic ' + Buffer.from(':' + pat).toString('base64');

const body = JSON.stringify([
  { op: 'add', path: '/fields/System.Title', value: 'TEST-Feature-please-delete' },
]);

fetch('https://dev.azure.com/qaisarit/meridianOS/_apis/wit/workitems/$Feature?api-version=7.1-preview.3', {
  method: 'POST',
  headers: { 'Authorization': auth, 'Content-Type': 'application/json-patch+json' },
  body,
}).then(async r => {
  console.log(r.status, r.statusText);
  const t = await r.text();
  console.log(t.slice(0, 500));
}).catch(e => console.error(e.message));
