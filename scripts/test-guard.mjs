// Loaded into every test file by `npm test` (--import). A test file has no reason to end its own process, and `node --test`
// counts a file that exits with 0 as passed, even when its tests never ran. Any such exit counts as a failure instead.
// Raises the bar for model-written tests (self-development); it isn't a sandbox: the CI jobs are separated for that.
const realExit = process.reallyExit.bind(process);
const refuse = (how) => (code) => {
  process.stderr.write(`test guard: the test file called ${how}(${code ?? ""}); counted as a failure\n`);
  realExit(1);
};
process.exit = refuse("process.exit");
process.reallyExit = refuse("process.reallyExit");
