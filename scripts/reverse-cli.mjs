// Bridge for an agent running the Krea 2 automation mode; never generates prompts itself.
import fs from 'node:fs';
const base = process.env.DFLOW_URL || 'http://127.0.0.1:4173';
const [command, id, value, preset] = process.argv.slice(2);
async function call(route, method='GET', body) {
  const res = await fetch(new URL(route, base), {method, headers:{'Content-Type':'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
  const data = await res.json();
  if (!res.ok) throw Error(`${res.status}: ${data.error || data.message || JSON.stringify(data)}`);
  return data;
}
try {
  let data;
  if (command === 'status') data = await call('/api/reverse/queue');
  else if (command === 'next') data = await call('/api/reverse/next','POST');
  else if (command === 'complete') {
    if (!id || !value || !preset) throw Error('Usage: complete ID PROMPT_FILE PRESET');
    data = await call(`/api/reverse/${encodeURIComponent(id)}/result`,'POST',{prompt:fs.readFileSync(value,'utf8'),resolvedPreset:preset});
  } else if (command === 'fail') {
    if (!id || !value) throw Error('Usage: fail ID REASON');
    data = await call(`/api/reverse/${encodeURIComponent(id)}/fail`,'POST',{reason:value});
  } else throw Error('Usage: node scripts/reverse-cli.mjs status|next|complete ID PROMPT_FILE PRESET|fail ID REASON');
  console.log(JSON.stringify(data,null,2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
