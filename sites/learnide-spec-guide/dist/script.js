const links = [...document.querySelectorAll('.side-nav a')];
const sections = links.map(link => document.querySelector(link.getAttribute('href'))).filter(Boolean);
const search = document.getElementById('topic-search');
const results = document.getElementById('search-results');
const sidebar = document.querySelector('.sidebar');
const toggle = document.getElementById('menu-toggle');

function closeMenu() {
  sidebar.classList.remove('open');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Open navigation');
}
toggle.addEventListener('click', () => {
  const open = sidebar.classList.toggle('open');
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
});
links.forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    event.preventDefault();
    if (window.innerWidth <= 900) { sidebar.classList.add('open'); toggle.setAttribute('aria-expanded', 'true'); }
    search.focus();
  }
  if (event.key === 'Escape') { search.value = ''; results.hidden = true; closeMenu(); }
});

const observer = new IntersectionObserver(entries => {
  const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible) return;
  links.forEach(link => {
    const active = link.getAttribute('href') === `#${visible.target.id}`;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
  });
}, { rootMargin: '-15% 0px -65% 0px', threshold: [0, .25, .5] });
sections.forEach(section => observer.observe(section));

search.addEventListener('input', () => {
  const query = search.value.trim().toLowerCase();
  if (!query) { results.hidden = true; results.replaceChildren(); return; }
  const matches = links.filter(link => {
    const section = document.querySelector(link.getAttribute('href'));
    return `${link.textContent} ${section?.dataset.search || ''} ${section?.textContent || ''}`.toLowerCase().includes(query);
  });
  results.replaceChildren();
  if (!matches.length) {
    const empty = document.createElement('p'); empty.textContent = 'No matching topics'; results.append(empty);
  } else {
    matches.forEach(link => {
      const item = document.createElement('a'); item.href = link.href; item.textContent = link.textContent;
      item.addEventListener('click', () => { search.value = ''; results.hidden = true; closeMenu(); });
      results.append(item);
    });
  }
  results.hidden = false;
});
