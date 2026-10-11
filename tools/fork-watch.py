#!/usr/bin/env python3
"""
Fork watch: reports new work in the youtube-webos fork network as suggestions.

Run by .github/workflows/fork-watch.yml. For every fork of the watched root
repositories that was pushed to since the last run, each branch is compared
with this repository's main branch; commits that are not in main and are newer
than the last run are listed. Pull requests opened or updated on the root
repositories since the last run are listed too. When anything is new, one
issue (label "fork-watch") is opened with the findings, so it arrives as a
GitHub notification. Nothing is merged or pushed - porting stays a decision.

The time of the last run is kept as a hidden marker in one closed issue,
"Fork watch state", so no branch or file has to be committed for it.
Commits that NicholasBly's main already has are left out: the Sync upstream
workflow brings those in. Bot commits (dependabot and the like) are skipped.

Environment: GITHUB_TOKEN, GITHUB_REPOSITORY (owner/name), optional
ROOT_REPOS (comma separated), FIRST_RUN_DAYS, MAX_BRANCHES, DRY_RUN=1.
"""

import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

API = 'https://api.github.com'
TOKEN = os.environ.get('GITHUB_TOKEN', '')
REPO = os.environ.get('GITHUB_REPOSITORY', 'foxi69/youtube-webos')
ROOTS = [r.strip() for r in os.environ.get(
    'ROOT_REPOS', 'NicholasBly/youtube-webos,webosbrew/youtube-webos,FriedChickenButt/youtube-webos').split(',') if r.strip()]
FIRST_RUN_DAYS = int(os.environ.get('FIRST_RUN_DAYS', '7'))
MAX_BRANCHES = int(os.environ.get('MAX_BRANCHES', '30'))
MAX_COMMITS_SHOWN = 15
DRY_RUN = os.environ.get('DRY_RUN') == '1'
LABEL = 'fork-watch'
STATE_TITLE = 'Fork watch state'
MARKER_RE = re.compile(r'<!-- fork-watch-last-run: (\S+) -->')


def request(method, path, body=None, params=None):
    url = path if path.startswith('http') else API + path
    if params:
        url += ('&' if '?' in url else '?') + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Accept', 'application/vnd.github+json')
    req.add_header('X-GitHub-Api-Version', '2022-11-28')
    if TOKEN:
        req.add_header('Authorization', 'Bearer ' + TOKEN)
    if data is not None:
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            text = res.read().decode()
            link = res.headers.get('Link', '')
            return (json.loads(text) if text else None), link
    except urllib.error.HTTPError as err:
        # 404 (deleted fork/branch), 409 (empty repo) and 422 (unrelated
        # histories) are normal in a fork network: skip, don't fail the run.
        if err.code in (404, 409, 422):
            return None, ''
        raise


def get(path, params=None):
    return request('GET', path, params=params)[0]


def get_all(path, params=None, limit=1000):
    """Follows Link: rel="next" pagination."""
    out = []
    params = dict(params or {}, per_page=100)
    data, link = request('GET', path, params=params)
    while True:
        if not data:
            break
        out.extend(data)
        if len(out) >= limit:
            break
        m = re.search(r'<([^>]+)>;\s*rel="next"', link or '')
        if not m:
            break
        data, link = request('GET', m.group(1))
    return out[:limit]


def parse_time(value):
    return dt.datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc)


def fmt_time(value):
    return value.strftime('%Y-%m-%dT%H:%M:%SZ')


def state_issue():
    issues = get_all(f'/repos/{REPO}/issues', {'labels': LABEL, 'state': 'all'}, limit=300)
    for issue in issues or []:
        if issue.get('title') == STATE_TITLE and 'pull_request' not in issue:
            return issue
    return None


def last_run_time(state):
    m = MARKER_RE.search((state or {}).get('body') or '')
    return parse_time(m.group(1)) if m else None


def upstream_shas():
    """Commits upstream main has and we don't: the sync workflow's job, not news."""
    cmp = get(f"/repos/{REPO}/compare/main...{ROOTS[0].split('/')[0]}:main")
    return {c['sha'] for c in (cmp or {}).get('commits', [])}, (cmp or {}).get('ahead_by', 0)


def watched_forks(since):
    """Forks of every root (and the roots themselves) pushed after `since`."""
    seen = {}
    for root in ROOTS:
        info = get(f'/repos/{root}')
        if info:
            seen[info['full_name']] = info
        for fork in get_all(f'/repos/{root}/forks', {'sort': 'newest'}, limit=3000):
            seen.setdefault(fork['full_name'], fork)
    me = REPO.lower()
    out = []
    for name, info in seen.items():
        if name.lower() == me or not info.get('pushed_at'):
            continue
        if parse_time(info['pushed_at']) > since:
            out.append(info)
    out.sort(key=lambda f: f['pushed_at'], reverse=True)
    return out


def is_bot(commit):
    login = (commit.get('author') or {}).get('login') or ''
    return login.endswith('[bot]') or commit['commit']['author']['name'].endswith('[bot]')


def new_commits(fork, since, seen):
    """Commits on the fork's branches that are not in our main and are newer than `since`.
    `seen` holds shas already reported (or upstream's), shared across forks."""
    owner = fork['owner']['login']
    branches = get_all(f"/repos/{fork['full_name']}/branches", limit=MAX_BRANCHES)
    found = {}
    for branch in branches or []:
        head = f"{owner}:{urllib.parse.quote(branch['name'], safe='')}"
        cmp = get(f'/repos/{REPO}/compare/main...{head}')
        if not cmp or not cmp.get('ahead_by'):
            continue
        for c in cmp.get('commits', []):
            if len(c.get('parents', [])) > 1:
                continue  # merge commits carry no change of their own
            when = parse_time(c['commit']['committer']['date'])
            if when <= since or c['sha'] in seen or is_bot(c):
                continue
            seen.add(c['sha'])
            found[c['sha']] = {
                'sha': c['sha'],
                'branch': branch['name'],
                'title': c['commit']['message'].splitlines()[0][:120],
                'author': (c.get('author') or {}).get('login') or c['commit']['author']['name'],
                'date': c['commit']['committer']['date'][:10],
                'url': c['html_url'],
            }
    return sorted(found.values(), key=lambda c: c['date'], reverse=True)


def new_pull_requests(since):
    out = []
    for root in ROOTS:
        pulls = get_all(f'/repos/{root}/pulls', {'state': 'all', 'sort': 'updated',
                                                  'direction': 'desc'}, limit=100)
        for pr in pulls or []:
            if parse_time(pr['updated_at']) <= since:
                break  # sorted by update time
            state = 'merged' if pr.get('merged_at') else pr['state']
            out.append({'repo': root, 'number': pr['number'], 'title': pr['title'],
                        'user': pr['user']['login'], 'state': state, 'url': pr['html_url'],
                        'updated': pr['updated_at'][:10]})
    return out


def esc(text):
    return text.replace('|', '\\|').replace('<', '&lt;')


def build_report(since, forks, pulls, upstream_ahead):
    lines = [f'New work in the youtube-webos fork network since {fmt_time(since)}.',
             '', 'These are suggestions only - nothing has been merged. '
             'Pick what is worth porting and ask for it (or cherry-pick it).', '']
    if upstream_ahead:
        lines += [f'**Upstream ({ROOTS[0]})** is {upstream_ahead} commit(s) ahead of main - '
                  'the Sync upstream workflow opens a pull request for those.', '']
    if pulls:
        lines += ['## Pull requests on the upstream repositories', '',
                  '| Repo | PR | Author | State | Updated |', '|---|---|---|---|---|']
        for p in pulls:
            lines.append(f"| {p['repo']} | [#{p['number']} {esc(p['title'])}]({p['url']}) "
                         f"| {p['user']} | {p['state']} | {p['updated']} |")
        lines.append('')
    if forks:
        lines += ['## New commits on forks', '']
        for fork, commits in forks:
            lines.append(f"### [{fork['full_name']}]({fork['html_url']}) - {len(commits)} new commit(s)")
            lines.append('')
            for c in commits[:MAX_COMMITS_SHOWN]:
                lines.append(f"- [`{c['sha'][:7]}`]({c['url']}) {esc(c['title'])} "
                             f"- {c['author']}, {c['date']}, branch `{esc(c['branch'])}`")
            if len(commits) > MAX_COMMITS_SHOWN:
                lines.append(f'- ... and {len(commits) - MAX_COMMITS_SHOWN} more')
            lines.append('')
    return '\n'.join(lines)


def ensure_label():
    if DRY_RUN or get(f'/repos/{REPO}/labels/{LABEL}'):
        return
    request('POST', f'/repos/{REPO}/labels',
            {'name': LABEL, 'color': '0e8a16', 'description': 'New work in the fork network'})


def save_state(now, state):
    """Moves the last-run marker forward in the (closed) state issue."""
    body = f'Bookkeeping for the fork watch workflow - safe to ignore.\n\n<!-- fork-watch-last-run: {fmt_time(now)} -->'
    if DRY_RUN:
        print('[dry run] state ->', fmt_time(now))
        return
    if state:
        request('PATCH', f"/repos/{REPO}/issues/{state['number']}", {'body': body})
        return
    created, _ = request('POST', f'/repos/{REPO}/issues',
                         {'title': STATE_TITLE, 'body': body, 'labels': [LABEL]})
    if created:
        request('PATCH', f"/repos/{REPO}/issues/{created['number']}", {'state': 'closed'})


def main():
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    state = state_issue()
    since = last_run_time(state)
    if since is None:
        since = now - dt.timedelta(days=FIRST_RUN_DAYS)
    print(f'Looking for work since {fmt_time(since)} in forks of {", ".join(ROOTS)}')

    ensure_label()
    seen, upstream_ahead = upstream_shas()
    forks = []
    for fork in watched_forks(since):
        commits = new_commits(fork, since, seen)
        print(f"{fork['full_name']}: {len(commits)} new commit(s)")
        if commits:
            forks.append((fork, commits))
    pulls = new_pull_requests(since)
    print(f'{len(pulls)} pull request(s) updated')

    if not forks and not pulls:
        print('Nothing new.')
        save_state(now, state)
        return

    title = f"Fork watch {now.strftime('%Y-%m-%d')}: {sum(len(c) for _, c in forks)} commit(s) on {len(forks)} fork(s), {len(pulls)} PR(s)"
    body = build_report(since, forks, pulls, upstream_ahead)
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as f:
            f.write(f'# {title}\n\n{body}\n')
    if DRY_RUN:
        print(title)
        print(body)
        return
    request('POST', f'/repos/{REPO}/issues', {'title': title, 'body': body, 'labels': [LABEL]})
    print('Opened issue:', title)
    save_state(now, state)


if __name__ == '__main__':
    try:
        main()
    except urllib.error.HTTPError as err:
        print(f'GitHub API error {err.code}: {err.read().decode()[:500]}', file=sys.stderr)
        sys.exit(1)
