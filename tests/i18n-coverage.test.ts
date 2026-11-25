// Hard-coded English in components: JSX text with letters, and aria-label / title / placeholder string literals.
// Informational ratchet: each file has a ceiling that may only go down. After translating, lower the number here.
// I18N_REPORT=1 node --test tests/i18n-coverage.test.ts prints the current counts as JSON.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("../src/components/", import.meta.url));
const ATTRS = new Set(["aria-label", "title", "placeholder"]);
const letters = (s: string) => /[A-Za-z]{2}/.test(s);

export function countHardcoded(src: string): number {
  const sf = ts.createSourceFile("x.tsx", src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  let n = 0;
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && letters(node.text)) n++;
    else if (ts.isJsxAttribute(node) && ATTRS.has(node.name.getText(sf))) {
      const init = node.initializer;
      const lit = init && ts.isJsxExpression(init) ? init.expression : init;
      if (lit && (ts.isStringLiteral(lit) || ts.isNoSubstitutionTemplateLiteral(lit)) && letters(lit.text)) n++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return n;
}

const files = readdirSync(ROOT, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".tsx")).sort();
const counts = Object.fromEntries(files.map((f) => [f.replaceAll("\\", "/"), countHardcoded(readFileSync(join(ROOT, f), "utf8"))]));

// Ceilings (current counts). Files not listed are reported only, never failed, so new components can land first.
const CEILING: Record<string, number> = {
  "ActivityView.tsx": 3, "AgentMission.tsx": 16, "AgentStatsCard.tsx": 9, "AgentsPanels.tsx": 0, "OperationsShell.tsx": 0, "AnalyticsShell.tsx": 0,
  "AgentsStation.tsx": 1, "AlertWatch.tsx": 0, "AlienScript.tsx": 0, "AmbientListener.tsx": 0, "AmbientOverlay.tsx": 0,
  "AmbientSound.tsx": 4, "ArchCrit.tsx": 8, "ArchDaylight.tsx": 13, "ArchMaterials.tsx": 24, "ArchPlans.tsx": 19, "ArchSite.tsx": 23,
  "ArchStudio.tsx": 27, "ArchTimeMachine.tsx": 14, "ArchWorld.tsx": 0, "AutonomySection.tsx": 13,
  "AutopilotPanel.tsx": 0, "BeliefsPanel.tsx": 16, "BootSequence.tsx": 0, "BusinessMap.tsx": 0, "BusinessPanel.tsx": 0,
  "CalendarCard.tsx": 0, "Chronicle.tsx": 14, "Cinematic.tsx": 4, "ClipFactory.tsx": 0, "ClipPicks.tsx": 4, "CodeHelper.tsx": 17,
  "CommandPalette.tsx": 3, "CompanyPanel.tsx": 15, "ContinueWork.tsx": 8, "ContractsPanel.tsx": 1, "CoreActivity.tsx": 0,
  "CoreAttach.tsx": 0, "CoreChats.tsx": 0, "CoreConfigPanel.tsx": 1, "CoreWorkspace.tsx": 0, "CountryDash.tsx": 36, "CourtPanel.tsx": 24,
  "CursorRing.tsx": 0, "DayPlan.tsx": 13, "DealCards.tsx": 32, "DemoOrbit.tsx": 11, "DevSessions.tsx": 7, "DevWorld.tsx": 0,
  "DoctorPanel.tsx": 1, "EngageCard.tsx": 8, "EpisodesList.tsx": 3, "EveningCapture.tsx": 5,
  "FollowingSection.tsx": 0, "Galaxy.tsx": 1, "GalaxyLoader.tsx": 1, "GameCopilot.tsx": 31, "GoalsPanel.tsx": 0,
  "GridCity.tsx": 19, "HalEye.tsx": 0, "Herald.tsx": 5, "Highlight.tsx": 0, "HivePanel.tsx": 11, "Hologram.tsx": 0, "HudFrame.tsx": 0,
  "HypeScore.tsx": 10, "IdeasPanel.tsx": 13, "InkGlyph.tsx": 0, "IntelligencePanel.tsx": 0, "InvoicesPanel.tsx": 2, "LastShorts.tsx": 0,
  "LaunchPackage.tsx": 23, "LearnedCard.tsx": 30, "LessonsCard.tsx": 16, "LifePanel.tsx": 0, "LifeReminders.tsx": 0, 
  "LivingEffects.tsx": 0, "LongformPanel.tsx": 18, "MaskText.tsx": 0,
  "MemoryClusters.tsx": 4, "MemoryControls.tsx": 5, "MemoryWorld.tsx": 0,
  "MissionControl.tsx": 25, "MissionsPanel.tsx": 7, "MoneyPanel.tsx": 0, "MorningBrief.tsx": 0, "MorningCard.tsx": 0,
  "MorningCards.tsx": 0, "NegotiatorBox.tsx": 24, "NewsGlobe.tsx": 24, "NicheCards.tsx": 32, "NightShift.tsx": 0,
  "NotificationCenter.tsx": 0, "OpenLoops.tsx": 0, "OperatorCard.tsx": 8, "Orbit.tsx": 4, "OrbitExplore.tsx": 1, "OrbitLog.tsx": 9,
  "ParticleCore.tsx": 0, "PasswordSection.tsx": 3, "PeopleRing.tsx": 36, "PerfBeacon.tsx": 0, "PerfRun.tsx": 0,
  "PersonaPlaytest.tsx": 26, "PersonaSection.tsx": 7, "PhonePairing.tsx": 16, "PlaceSection.tsx": 11,
  "PlaytestBot.tsx": 10, "PortfolioPanel.tsx": 27, "ProposalsPanel.tsx": 6, "ReachPanel.tsx": 13, "RealSky.tsx": 0, "RecipesPanel.tsx": 3,
  "RefBoard.tsx": 31, "RemoteApp.tsx": 0, "RemoteCall.tsx": 18, "RemoteCar.tsx": 6, "RemoteHome.tsx": 0, "ResultEvidence.tsx": 8,
  "ReviewQueue.tsx": 0, "Rewind.tsx": 4, "RivalsBox.tsx": 7, "RobloxBuild.tsx": 21, "RulesView.tsx": 0, "ScanMeasure.tsx": 8,
  "ScenePlanner.tsx": 29, "SchoolPanel.tsx": 0, "ScreenApp.tsx": 14, "ScreenLook.tsx": 9, "Ships.tsx": 0, "ShortcutsOverlay.tsx": 0,
  "ShortsBoard.tsx": 0, "ShortsPlanCard.tsx": 7, "SkillsPanel.tsx": 11, "SoundFinder.tsx": 17, "SplatCloud.tsx": 0, "Stage.tsx": 0,
  "StatusRail.tsx": 0, "StopAll.tsx": 0, "StoryPanel.tsx": 41, "StudioCalendar.tsx": 12, "StudioNotifier.tsx": 0, "StudioStats.tsx": 0,
  "StudioWorld.tsx": 0, "StudyButton.tsx": 3, "StudyCards.tsx": 31, "TeamBuilder.tsx": 12, "Terminal.tsx": 5, "TextureStudio.tsx": 13,
  "ThumbMaker.tsx": 9, "Ticker.tsx": 0, "TimeCapsuleSection.tsx": 20, "TimeDilation.tsx": 19, "TimeTravel.tsx": 4,
  "TrendRadar.tsx": 27, "TwinCard.tsx": 9, "Universe.tsx": 0, "VaultBits.tsx": 0, "VaultFileSheet.tsx": 0, "VaultPlanet.tsx": 0, "VisibilityPanel.tsx": 8,
  "VoiceMemo.tsx": 0, "WarmCompile.tsx": 0, "WarpOverlay.tsx": 0, "WeeklyCard.tsx": 7, "WhatIf.tsx": 12, "WhatsNew.tsx": 0,
  "WorkspacePanel.tsx": 11, "ZoomRig.tsx": 0, "alien/Filaments.tsx": 0, "alien/Fractal.tsx": 0, "alien/Lensing.tsx": 0,
  "alien/LiquidPlanet.tsx": 0, "alien/MicroWorld.tsx": 0, "alien/NeuralArms.tsx": 0, "alien/Singularity.tsx": 0,
  "alien/WindowPlanet.tsx": 0, "dev-timing.tsx": 0, "i18n.tsx": 0, "panels.tsx": 0, "real-sky-toggle.tsx": 2,
  "voice/VoiceControls.tsx": 36,
};

test("counter sees text nodes and the three attributes, not translated calls", () => {
  assert.equal(countHardcoded(`const a = <p title="Hello there" aria-label={t("x")}>Hi you {t("y")} <b>ok</b> · 3</p>;`), 3);
  assert.equal(countHardcoded(`const a = <input placeholder={\`Ask me\`} alt="Photo" />;`), 1);
});

test("hard-coded English per component never grows", () => {
  if (process.env.I18N_REPORT) console.log(JSON.stringify(counts, null, 1));
  const over = Object.entries(CEILING).filter(([f, max]) => f in counts && counts[f] > max).map(([f, max]) => `${f}: ${counts[f]} > ${max}`);
  assert.deepEqual(over, [], "new hard-coded English: use t() from useT() and add keys to src/lib/i18n-pure.ts (BASE + ET)");
});
