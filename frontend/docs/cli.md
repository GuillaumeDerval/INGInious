# Command-line tools

The legacy Python frontend shipped three command-line tools that depended on its modules. They are
re-implemented in TypeScript in `app/cli/` and reuse the server code of the web app (course/task model,
backend client, configuration, password hashing, account creation):

| Command | Legacy | Source |
|---|---|---|
| `inginious-autotest` | `inginious-autotest` (scripts/autotest.py) | `app/cli/autotest.ts` |
| `inginious-test-task` | `inginious-test-task` (scripts/task_tester/task_tester.py) | `app/cli/test-task.ts` |
| `inginious-setup` | `inginious-install` (frontend/installer.py), reduced | `app/cli/setup.ts` |

`inginious-submission-anonymizer` is not ported: it only uses `inginious.common`, which stays with the
backend package.

## Build and installation

```sh
cd app
npm run build:cli          # bundles the commands into build-cli/ (cli/vite.config.ts)
node build-cli/inginious-autotest.js --help
npm link                   # optional: puts the three commands of package.json "bin" on the PATH
```

The bundle needs the runtime `dependencies` of `app/package.json` (`npm ci --omit=dev`), like the web
server. Every command prints its help with `-h`/`--help`; a bad command line prints the usage line and
exits with code 2 (as argparse did).

## inginious-autotest

```
inginious-autotest [-h] [--logging] [-f FILE] [-b BACKEND] [--tdisp TDISP ...] [--ptype PTYPE ...] task_dir course_dir
```

For every task folder of `course_dir` (a course of `task_dir`, the `tasks_directory`): re-grades each
recorded submission of `<task>/test/` (YAML: `courseid`, `taskid`, `input` and the expected `result`,
`grade`, `problems`, `tests`, `custom`, `state`, `stdout`, `stderr`) and compares the outputs (keys
missing on either side and archives are ignored); checks that `task.yaml` loads and that its context and
problem headers render without RST warning. Failures are printed as JSON (`{path: {key: [recorded, new]}}`,
or the content of an invalid task.yaml), or written to `FILE` with `-f`, and the exit code is 66 (also for
any error, e.g. `Environment not available`); 0 when everything is consistent. `--logging` prints each
replayed file on stderr.

## inginious-test-task

```
inginious-test-task [-h] [-c CONFIG] [-v] [-p [PLUGINS ...]] courseid [taskids ...]
```

Reads the instance configuration (`-c`, else `./configuration.yaml` or `./configuration.json`), connects
to its backend and replays the `<task>/test/*.test` submissions of the given tasks (all tasks by default;
tasks with a `.testignore` file are skipped), checking the global result and every recorded test tag.
Colored report on stdout (same messages as the legacy tool); `-v` prints the grading container output.
Exit code 1 when a test failed, 0 otherwise.

## inginious-setup

```
inginious-setup [-h] [--file FILE] [--default] [--backend ADDR] [--mongo-host HOST] [--mongo-database NAME]
                [--tasks-directory DIR] [--backup-directory DIR] [--superadmin LOGIN] [--superadmin-name NAME]
                [--superadmin-email EMAIL] [--superadmin-password PASSWORD] [--https yes|no]
                [--smtp-host HOST] [--smtp-port PORT] [--smtp-sender FROM] [--webdav-host URL]
```

Asks each setting not given as an option (`question [default]:`, an empty answer keeps the default;
`--default` answers every remaining question with its default), checks MongoDB (fatal) and the backend
(warning only), creates the tasks and backup directories and the superadmin account (argon2id; skipped if
the login exists), then writes `FILE` (default `./configuration.yaml`) with `backend`, `mongo_opt`,
`tasks_directory`, `backup_directory`, `superadmins`, `session_parameters` (new random `secret_key`,
`timeout` 86400, `secure` from `--https`) and, when given, `smtp` and `webdav_host`. Exit code 0, or 1 on
error (nothing is written).

## Differences with the legacy tools

* **Backend**: the tools connect to a running backend (`backend` of the configuration; `-b` for autotest,
  default `tcp://127.0.0.1:2000`) instead of starting a `local` docker backend. test-task waits until the
  backend announced its environments (at most 15 s) instead of always sleeping 15 s.
* **Plugins / problem types**: Python classes cannot be loaded. `--ptype` (autotest) and `-p` (test-task)
  take problem *type names* (e.g. `pl`), registered as generic problems so that such tasks load (the
  agents grade them); `--tdisp` is accepted and ignored (unknown dispensers fall back to the table of
  contents).
* **autotest**: JSON output is compact (`JSON.stringify`); task folders and test files are processed in
  name order; an invalid course (including an invalid evaluation mode, validated when the course loads)
  is an error (66) rather than a per-task "WEB TASK ERROR".
* **test-task**: tag values are compared deeply and printed as JSON; tasks are processed in name order.
* **setup** (renamed from `inginious-install` to avoid a clash with the backend package): no docker
  `local` backend, container build, demo task download, LDAP plugin or webterm questions; all answers are
  asked first, then checked; an unreachable MongoDB or an invalid superadmin is fatal instead of re-asked.
