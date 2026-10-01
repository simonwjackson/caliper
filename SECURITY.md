# Security

Caliper is a development tool. It reads and writes your project's source
files, and it can send that source to a model endpoint. Run it only on a
machine and a network that you trust.

## Report a problem

Report a vulnerability privately through GitHub: open the repository's
**Security** tab and select **Report a vulnerability**. Do not open a public
issue for it. Caliper is maintained by one person, so there is no response
time guarantee.

## What the Caliper app trusts

**The app's port has no login.** Anyone who can reach that port can do what
you can do in the app, for every registered project:

- read every file the plugin serves, and write project files through the code
  pane, knobs and accepted takes;
- start agents, which use your model endpoint and your API key.

The app listens on `127.0.0.1` by default. `--host` or `CALIPER_HOST` changes
that. Do not bind it to a public address. If you put a proxy in front of it,
the proxy decides who can reach every project. A private network such as a
tailnet gives every device on that network full access.

**Each dev server has a write token.** The plugin makes one at start and keeps
it only in its registry file, which has mode `0600`. The app adds the token
when it forwards a write, so the token never reaches a browser. The app refuses
a write from a page on another origin. Any process that runs as your user can
read the token.

**The project's dev server port is a normal Vite port.** Frame pages, Vite
modules and the HMR socket on it need no token, as in plain Vite.

**All projects share one browser origin.** Products open in the app share
`localStorage`, IndexedDB and cookies with each other and with the chrome.

## What the agent can do

- An agent reads project files, and writes only into its own take folder under
  `.caliper/takes/<n>/`. It cannot run commands. The real files change only
  when you accept a take.
- The agent sends the files it reads, its renders and your prompts to the
  model endpoint in the app's settings. Use an endpoint that you trust with
  your source.
- The API key comes only from an environment variable. The app refuses a
  settings file that holds a key.
- A project's skills are instructions for the agent. Caliper trusts them as
  much as the project's `vite.config`, which Vite already runs.

## What Caliper does not do

- It does not prove that a part is sealed. A part can still use the network,
  the clock or shared storage.
- It does not sandbox the project's code. Parts run in your browser with the
  same rights as the app you develop.
