// BUSINESS what-if (roadmap 3): 10k Monte Carlo months off the main thread so dragging a slider never stalls the page.
// Message: {id, scenario, seed} → {id, result} (profits buffer transferred) or {id, error}.
import { simulate, type Scenario } from "../lib/whatif-pure.ts";

self.onmessage = (e: MessageEvent<{ id: number; scenario: Scenario; seed: number }>) => {
  const { id, scenario, seed } = e.data;
  try {
    const result = simulate(scenario, seed);
    self.postMessage({ id, result }, { transfer: [result.profits.buffer] });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : "Simulation failed" });
  }
};
