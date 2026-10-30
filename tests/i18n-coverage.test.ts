// Hard-coded English in components: JSX text with letters, and aria-label / title / placeholder string literals.
// Informational ratchet: each file has a ceiling that may only go down. After translating, lower the number here.
// I18N_REPORT=1 node --test tests/i18n-coverage.test.ts prints the current counts as JSON.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const ROOT = new URL("../src/components/", import.meta.url).pathname;
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
  "ActivityView.tsx": 3, "AgentMission.tsx": 23, "AgentScorecard.tsx": 17, "AgentStatsCard.tsx": 9, "AgentsPanels.tsx": 1,
  "AgentsStation.tsx": 13, "AlertWatch.tsx": 0, "AlienScript.tsx": 0, "AmbientListener.tsx": 0, "AmbientOverlay.tsx": 0,
  "AmbientSound.tsx": 4, "ArchCrit.tsx": 8, "ArchDaylight.tsx": 13, "ArchMaterials.tsx": 24, "ArchPlans.tsx": 19, "ArchSite.tsx": 23,
  "ArchStudio.tsx": 27, "ArchTimeMachine.tsx": 14, "ArchWorld.tsx": 0, "AutomationFields.tsx": 26, "AutonomySection.tsx": 13,
  "AutopilotPanel.tsx": 0, "BeliefsPanel.tsx": 16, "BootSequence.tsx": 0, "BusinessMap.tsx": 0, "BusinessPanel.tsx": 49,
  "CalendarCard.tsx": 5, "Chronicle.tsx": 14, "Cinematic.tsx": 5, "ClipFactory.tsx": 0, "ClipPicks.tsx": 4, "CodeHelper.tsx": 17,
  "CommandPalette.tsx": 10, "CompanyPanel.tsx": 15, "ContinueWork.tsx": 8, "ContractsPanel.tsx": 48, "CoreActivity.tsx": 4,
  "CoreAttach.tsx": 2, "CoreChats.tsx": 24, "CoreConfigPanel.tsx": 3, "CoreWorkspace.tsx": 15, "CountryDash.tsx": 36, "CourtPanel.tsx": 24,
  "CursorRing.tsx": 0, "DayPlan.tsx": 13, "DealCards.tsx": 32, "DemoOrbit.tsx": 11, "DevSessions.tsx": 7, "DevWorld.tsx": 51,
  "DoctorPanel.tsx": 1, "DreamsList.tsx": 6, "EngageCard.tsx": 8, "EpisodesList.tsx": 3, "EveningCapture.tsx": 5,
  "FollowingSection.tsx": 8, "Galaxy.tsx": 1, "GalaxyLoader.tsx": 1, "GameCopilot.tsx": 31, "GameLab.tsx": 9, "GoalsPanel.tsx": 0,
  "GridCity.tsx": 19, "HalEye.tsx": 0, "Herald.tsx": 9, "Highlight.tsx": 0, "HivePanel.tsx": 11, "Hologram.tsx": 0, "HudFrame.tsx": 0,
  "HypeScore.tsx": 10, "IdeasPanel.tsx": 14, "InkGlyph.tsx": 0, "IntelligencePanel.tsx": 17, "InvoicesPanel.tsx": 46, "LastShorts.tsx": 17,
  "LaunchPackage.tsx": 23, "LearnedCard.tsx": 30, "LessonsCard.tsx": 16, "LifePanel.tsx": 1, "LifeReminders.tsx": 0, "LifeStats.tsx": 5,
  "LivingEffects.tsx": 0, "LongformPanel.tsx": 18, "MarketWatcher.tsx": 0, "MarketsPanel.tsx": 0, "MaskText.tsx": 0,
  "MemoryClusters.tsx": 4, "MemoryControls.tsx": 5, "MemoryPalace.tsx": 7, "MemoryWorld.tsx": 20,
  "MissionControl.tsx": 25, "MissionsPanel.tsx": 7, "MoneyPanel.tsx": 53, "MorningBrief.tsx": 0, "MorningCard.tsx": 1,
  "MorningCards.tsx": 7, "NegotiatorBox.tsx": 25, "NewsGlobe.tsx": 24, "NicheCards.tsx": 32, "NightShift.tsx": 0,
  "NotificationCenter.tsx": 16, "OpenLoops.tsx": 0, "OperatorCard.tsx": 8, "Orbit.tsx": 5, "OrbitExplore.tsx": 2, "OrbitLog.tsx": 9,
  "OrbitThinks.tsx": 23, "ParticleCore.tsx": 0, "PasswordSection.tsx": 3, "PeopleRing.tsx": 36, "PerfBeacon.tsx": 0, "PerfRun.tsx": 0,
  "PerfRuns.tsx": 12, "PersonaPlaytest.tsx": 26, "PersonaSection.tsx": 7, "PhonePairing.tsx": 17, "PlaceSection.tsx": 11,
  "PlaytestBot.tsx": 10, "PortfolioPanel.tsx": 27, "ProposalsPanel.tsx": 6, "ReachPanel.tsx": 13, "RealSky.tsx": 0, "RecipesPanel.tsx": 3,
  "RefBoard.tsx": 31, "RemoteApp.tsx": 7, "RemoteCall.tsx": 18, "RemoteCar.tsx": 6, "RemoteHome.tsx": 0, "ResultEvidence.tsx": 8,
  "ReviewQueue.tsx": 35, "Rewind.tsx": 4, "RivalsBox.tsx": 7, "RobloxBuild.tsx": 21, "RulesView.tsx": 0, "ScanMeasure.tsx": 8,
  "ScenePlanner.tsx": 29, "SchoolPanel.tsx": 46, "ScreenApp.tsx": 14, "ScreenLook.tsx": 9, "Ships.tsx": 0, "ShortcutsOverlay.tsx": 2,
  "ShortsBoard.tsx": 25, "ShortsPlanCard.tsx": 7, "SkillsPanel.tsx": 11, "SoundFinder.tsx": 17, "SplatCloud.tsx": 0, "Stage.tsx": 0,
  "StatusRail.tsx": 0, "StopAll.tsx": 0, "StoryPanel.tsx": 41, "StudioCalendar.tsx": 12, "StudioNotifier.tsx": 2, "StudioStats.tsx": 0,
  "StudioWorld.tsx": 34, "StudyButton.tsx": 3, "StudyCards.tsx": 31, "TeamBuilder.tsx": 12, "Terminal.tsx": 5, "TextureStudio.tsx": 13,
  "TheaterWorld.tsx": 36, "ThumbMaker.tsx": 9, "Ticker.tsx": 1, "TimeCapsuleSection.tsx": 20, "TimeDilation.tsx": 21, "TimeTravel.tsx": 4,
  "TrendRadar.tsx": 27, "TwinCard.tsx": 9, "Universe.tsx": 0, "UsageMeter.tsx": 30, "VaultPanel.tsx": 31, "VisibilityPanel.tsx": 8,
  "VoiceMemo.tsx": 11, "WarmCompile.tsx": 0, "WarpOverlay.tsx": 0, "WeeklyCard.tsx": 7, "WhatIf.tsx": 12, "WhatsNew.tsx": 0,
  "WorkspacePanel.tsx": 11, "ZoomRig.tsx": 0, "alien/Filaments.tsx": 0, "alien/Fractal.tsx": 0, "alien/Lensing.tsx": 0,
  "alien/LiquidPlanet.tsx": 0, "alien/MicroWorld.tsx": 0, "alien/NeuralArms.tsx": 0, "alien/Singularity.tsx": 0,
  "alien/WindowPlanet.tsx": 0, "dev-timing.tsx": 0, "i18n.tsx": 0, "panels.tsx": 1, "real-sky-toggle.tsx": 2,
  "voice/VoiceControls.tsx": 45,
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
