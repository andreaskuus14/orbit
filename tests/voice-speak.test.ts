import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/voice/speak.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source.replace("import.meta.url", '"file:///test/speak.js"'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

for (const rejected of [false, true]) {
  test(`stopping Kokoro during device resume discards the sentence when resume ${rejected ? "rejects" : "resolves"}`, async () => {
    let finishResume!: () => void;
    const resume = new Promise<void>((resolve, reject) => {
      finishResume = rejected ? () => reject(new Error("Device unavailable")) : resolve;
    });
    const spoken: string[] = [];
    let audioStarts = 0, resumeCalls = 0;
    class FakeContext {
      state = "suspended";
      destination = {};
      resume() { resumeCalls++; return resume; }
      createBuffer() { return { copyToChannel() {} }; }
      createAnalyser() { return { connect() {}, disconnect() {} }; }
      createBufferSource() { return { connect() {}, start() { audioStarts++; }, stop() {} }; }
    }
    class FakeWorker {
      onmessage?: (e: { data: object }) => void;
      postMessage({ id }: { id: number }) {
        queueMicrotask(() => this.onmessage?.({ data: { id, audio: new Float32Array(4), rate: 24000 } }));
      }
    }
    const window = {
      speechSynthesis: { addEventListener() {}, cancel() {}, getVoices: () => [], speak: (u: { text: string }) => spoken.push(u.text) },
      addEventListener() {},
      setTimeout,
    };
    const exports = {} as { speakChunk: (text: string) => void; stop: () => void; isSpeaking: () => boolean };
    runInNewContext(compiled, {
      exports, window, URL, clearTimeout, performance,
      AudioContext: FakeContext, Worker: FakeWorker,
      SpeechSynthesisUtterance: class { text: string; constructor(text: string) { this.text = text; } },
      requestAnimationFrame: () => 1,
      require: () => ({ voiceLevel: { speak: 0 }, loadVoiceSettings: () => ({ lang: "en-US", voiceURI: "kokoro:af_heart", rate: 1 }) }),
    });

    exports.speakChunk("Cancelled sentence");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(resumeCalls, 1);
    assert.equal(exports.isSpeaking(), true);
    exports.stop();
    finishResume();
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    assert.equal(audioStarts, 0);
    assert.deepEqual(spoken, []);
    assert.equal(exports.isSpeaking(), false);
  });
}
