// Runs one search or one replace of project-search.js off the main thread and
// posts its result back.
const { parentPort, workerData } = require('worker_threads');
const projectSearch = require('../project-search');

let result;
try {
  const { type, root, options, deadline } = workerData || {};
  result = type === 'replace'
    ? projectSearch.replaceInRoot(root, options)
    : projectSearch.searchRoot(root, options, { deadline: deadline || Infinity });
} catch (err) {
  result = { ok: false, error: err.message };
}
parentPort.postMessage(result);
