// A pull request's page on GitHub in a window of its own (web-window.html,
// main.js openWebWindow): the address and the title come in the query.
(function () {
  const params = new URLSearchParams(location.search);
  const url = params.get('url') || '';
  const title = params.get('title') || '';
  if (title) document.title = title;
  const root = document.getElementById('web-window');
  if (!webPageCanShow(url)) {
    root.innerHTML = '<p class="web-window-empty">This address cannot be shown here.</p>';
    return;
  }
  const page = mountWebPage(root, { url, title, inWindow: true });
  setupWindowPin(root.querySelector('#tool-window-pin'));
  page.focus();
})();
