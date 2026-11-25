"use client";
// One broken section must not take ORBIT down: without a boundary a render error anywhere unmounted the whole app (black
// screen, galaxy gone). Each world and planet panel sits inside one; the error is logged (console + the browser's error event,
// so PerfBeacon/crash tooling still sees it) and a calm card offers Try again (remount) and, where given, Back to galaxy.
import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { useT } from "./i18n";
import { isChunkError } from "@/lib/stale-build-pure";
import { reloadOnce } from "./StaleBuildWatch";
import { Button } from "./ui";

// quiet: a decorative part (a 3D scene) that fails just drops out, so the planet's panel next to it keeps working (no GPU / no WebGL).
type Props = { name: string; onBack?: () => void; quiet?: boolean; children: ReactNode };

function Fallback({ name, onRetry, onBack }: { name: string; onRetry: () => void; onBack?: () => void }) {
  const { t } = useT();
  return (
    // Kit look (design-language.md): neutral card, Inter, the planet's own accent on Try again; no gradient or mono capitals.
    <div className="planet-boundary card pu" data-planet={name} role="alert" data-boundary={name}>
      <span className="planet-boundary-mark" aria-hidden="true" />
      <b>{t("boundary.title")}</b>
      <p className="muted text-sm">{t("boundary.body")}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={onRetry}>{t("boundary.retry")}</Button>
        {onBack && <Button variant="ghost" size="sm" onClick={onBack}>{t("arch.backGalaxy")}</Button>}
      </div>
    </div>
  );
}

export class PlanetBoundary extends Component<Props, { failed: boolean; n: number }> {
  state = { failed: false, n: 0 };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[orbit] ${this.props.name} crashed:`, error, info.componentStack);
    // A chunk from the build before a live update is gone (404): reload once instead of showing the card.
    if (isChunkError(error)) reloadOnce();
  }
  render() {
    if (this.state.failed && this.props.quiet) return null;
    if (this.state.failed) return <Fallback name={this.props.name} onBack={this.props.onBack} onRetry={() => this.setState((s) => ({ failed: false, n: s.n + 1 }))} />;
    return <Fragment key={this.state.n}>{this.props.children}</Fragment>; // Try again remounts the subtree with fresh state
  }
}
