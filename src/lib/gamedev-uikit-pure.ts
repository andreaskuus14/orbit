// GAME DEV DEV04: a reusable UI kit per game (type, spacing, buttons, inventory cards, currency, feedback), stored on the game
// next to its contract. Preview checks (short/long text, touch, low-res) and a Roblox Luau ModuleScript generated from the kit.
// Pure; tested in tests/gamedev-uikit.test.ts. Nothing is pushed to Roblox: the owner pastes the module into Studio himself.
import { no, rec, str } from "./gamedev-pure.ts";

/** Legacy Enum.Font names: valid in every Roblox TextLabel. */
export const KIT_FONTS = ["GothamBold", "Gotham", "FredokaOne", "LuckiestGuy", "SourceSansBold", "SourceSans", "Arcade", "Cartoon", "Ubuntu"] as const;
export const KIT_COLORS = ["surface", "text", "primary", "primaryText", "accent", "danger", "success"] as const;
export const PREVIEW_MODES = ["short", "long", "touch", "lowres"] as const;
export type PreviewMode = (typeof PREVIEW_MODES)[number];
export type UiKit = {
  font: (typeof KIT_FONTS)[number]; body: number; title: number; spacing: number; radius: number; card: number;
  colors: Record<(typeof KIT_COLORS)[number], string>; currency: string; icon: string;
};
export const DEFAULT_KIT: UiKit = {
  font: "GothamBold", body: 18, title: 28, spacing: 13, radius: 10, card: 120,
  colors: { surface: "#1e293b", text: "#f8fafc", primary: "#22c55e", primaryText: "#052e16", accent: "#facc15", danger: "#ef4444", success: "#4ade80" },
  currency: "Coins", icon: "",
};
const LIMITS = { body: [10, 48], title: [12, 72], spacing: [0, 40], radius: [0, 40], card: [60, 400] } as const;
const HEX = /^#[0-9a-f]{6}$/i, ICON = /^rbxassetid:\/\/\d{1,20}$/;
export const SAMPLE_TEXT: Record<"short" | "long", string> = { short: "Buy", long: "Hatch the Legendary Golden Dragon Egg now" };

export function cleanKit(v: unknown, at: string): UiKit | undefined {
  if (v == null) return undefined;
  if (!rec(v) || !rec(v.colors)) return no(`${at} UI kit is invalid`);
  const n = (k: keyof typeof LIMITS) => { const x = v[k], [lo, hi] = LIMITS[k]; return Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi ? (x as number) : no(`${at} UI kit ${k} must be ${lo}–${hi}`); };
  const colors = {} as UiKit["colors"];
  for (const k of KIT_COLORS) { const c = v.colors[k]; colors[k] = typeof c === "string" && HEX.test(c) ? c.toLowerCase() : no(`${at} UI kit colour ${k} must be #rrggbb`); }
  const icon = str(v.icon, 40);
  return {
    font: KIT_FONTS.includes(v.font as UiKit["font"]) ? (v.font as UiKit["font"]) : no(`${at} UI kit font is unknown`),
    body: n("body"), title: n("title"), spacing: n("spacing"), radius: n("radius"), card: n("card"), colors,
    currency: str(v.currency, 24) || "Coins", icon: !icon || ICON.test(icon) ? icon : no(`${at} UI kit icon must be rbxassetid://<number>`),
  };
}

/** WCAG contrast ratio of two #rrggbb colours (1–21). */
export function contrast(a: string, b: string): number {
  const lum = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}

export const buttonHeight = (k: UiKit) => k.body + 2 * k.spacing;
/** shortcut: text width estimated at 0.55 em per character, not measured with the font; good enough to spot overflow before Studio. */
export const textLines = (text: string, size: number, width: number) => Math.max(1, Math.ceil((text.length * size * 0.55) / Math.max(1, width)));
/** Characters that fit in `lines` lines before TextTruncate cuts them. */
export const visibleChars = (size: number, width: number, lines: number) => Math.floor((lines * width) / (size * 0.55));
const LONG_MIN = 16, TOUCH_MIN = 44, LOWRES_W = 640, LOWRES_MIN_TEXT = 14;

/** What the kit gets wrong in one preview mode; empty = fine. Codes are i18n keys under gd.ui.i.* */
export type KitIssue = "textContrast" | "buttonContrast" | "currencyWraps" | "longTruncated" | "touchTarget" | "lowresText" | "lowresFit";
export function kitIssues(k: UiKit, mode: PreviewMode): KitIssue[] {
  const out: KitIssue[] = [];
  if (contrast(k.colors.text, k.colors.surface) < 4.5) out.push("textContrast");
  if (contrast(k.colors.primaryText, k.colors.primary) < 4.5) out.push("buttonContrast");
  const inner = k.card - 2 * k.spacing;
  if (mode === "short" && textLines(abbrev(999_999), k.body, inner) > 1) out.push("currencyWraps");
  if (mode === "long" && visibleChars(k.body, inner, 2) < LONG_MIN) out.push("longTruncated"); // names wrap to 2 lines, then end in "…"
  if (mode === "touch" && buttonHeight(k) < TOUCH_MIN) out.push("touchTarget");
  if (mode === "lowres") {
    if (k.body < LOWRES_MIN_TEXT) out.push("lowresText");
    if (Math.floor((LOWRES_W - k.spacing) / (k.card + k.spacing)) < 3) out.push("lowresFit");
  }
  return out;
}

/** 1234 → "1.2K", same rule as Kit.Abbrev in the Luau module. */
export function abbrev(n: number): string {
  const units = ["", "K", "M", "B", "T"];
  let i = 0, x = Math.abs(n);
  while (x >= 1000 && i < units.length - 1) { x /= 1000; i++; }
  const s = i === 0 ? String(Math.floor(x)) : (Math.floor(x * 10) / 10).toString();
  return `${n < 0 ? "-" : ""}${s}${units[i]}`;
}

const lua = (s: string) => `"${s.replace(/[\\"]/g, "\\$&").replace(/[\x00-\x1f]/g, "")}"`;

/** The kit as a Roblox ModuleScript (ReplicatedStorage): Theme table + Button, InventoryCard, CurrencyLabel and Toast constructors. */
export function kitLuau(k: UiKit, game: string): string {
  const c = KIT_COLORS.map((x) => `\t\t${x[0].toUpperCase()}${x.slice(1)} = Color3.fromHex(${lua(k.colors[x])}),`).join("\n");
  return `-- ${game.replace(/[\r\n]/g, " ").slice(0, 60)} UI kit, generated by ORBIT from the game contract. Put in ReplicatedStorage as a ModuleScript.
local TweenService = game:GetService("TweenService")
local Kit = {}
Kit.Theme = {
\tFont = Enum.Font.${k.font},
\tBody = ${k.body}, Title = ${k.title}, Spacing = ${k.spacing}, Radius = ${k.radius}, Card = ${k.card}, TouchMin = ${TOUCH_MIN},
\tCurrency = ${lua(k.currency)}, CurrencyIcon = ${lua(k.icon)},
\tColors = {
${c}
\t},
}
local T = Kit.Theme

local function corner(p: GuiObject)
\tlocal c = Instance.new("UICorner"); c.CornerRadius = UDim.new(0, T.Radius); c.Parent = p
end
local function pad(p: GuiObject)
\tlocal u = Instance.new("UIPadding")
\tfor _, side in ipairs({ "PaddingTop", "PaddingBottom", "PaddingLeft", "PaddingRight" }) do (u :: any)[side] = UDim.new(0, T.Spacing) end
\tu.Parent = p
end
local function text(l: TextLabel | TextButton, s: string, size: number, color: Color3)
\tl.Font = T.Font; l.TextSize = size; l.TextColor3 = color; l.Text = s
\tl.TextWrapped = true; l.TextTruncate = Enum.TextTruncate.AtEnd
end

function Kit.Abbrev(n: number): string
\tlocal units = { "", "K", "M", "B", "T" }
\tlocal i, x = 1, math.abs(n)
\twhile x >= 1000 and i < #units do x /= 1000; i += 1 end
\tlocal s = if i == 1 then tostring(math.floor(x)) else tostring(math.floor(x * 10) / 10)
\treturn (if n < 0 then "-" else "") .. s .. units[i]
end

function Kit.Button(label: string, onClick: (() -> ())?): TextButton
\tlocal b = Instance.new("TextButton")
\tb.AutomaticSize = Enum.AutomaticSize.X
\tb.Size = UDim2.fromOffset(0, math.max(T.TouchMin, T.Body + 2 * T.Spacing))
\tb.BackgroundColor3 = T.Colors.Primary; b.AutoButtonColor = true
\ttext(b, label, T.Body, T.Colors.PrimaryText); corner(b); pad(b)
\tif onClick then b.Activated:Connect(onClick) end
\treturn b
end

function Kit.InventoryCard(name: string, rarity: string, image: string?): Frame
\tlocal f = Instance.new("Frame")
\tf.Size = UDim2.fromOffset(T.Card, T.Card + T.Body * 2)
\tf.BackgroundColor3 = T.Colors.Surface; corner(f); pad(f)
\tlocal list = Instance.new("UIListLayout"); list.Padding = UDim.new(0, T.Spacing // 2); list.Parent = f
\tlocal img = Instance.new("ImageLabel")
\timg.Size = UDim2.new(1, 0, 0, T.Card - 2 * T.Spacing); img.BackgroundTransparency = 1; img.ScaleType = Enum.ScaleType.Fit
\timg.Image = image or ""; img.Parent = f
\tlocal n = Instance.new("TextLabel"); n.BackgroundTransparency = 1; n.Size = UDim2.new(1, 0, 0, T.Body * 2)
\ttext(n, name, T.Body, T.Colors.Text); n.Parent = f
\tf:SetAttribute("Rarity", rarity)
\treturn f
end

function Kit.CurrencyLabel(amount: number): (Frame, (number) -> ())
\tlocal f = Instance.new("Frame"); f.AutomaticSize = Enum.AutomaticSize.X
\tf.Size = UDim2.fromOffset(0, T.Body + 2 * T.Spacing); f.BackgroundColor3 = T.Colors.Surface; corner(f); pad(f)
\tlocal row = Instance.new("UIListLayout"); row.FillDirection = Enum.FillDirection.Horizontal; row.Padding = UDim.new(0, T.Spacing // 2)
\trow.VerticalAlignment = Enum.VerticalAlignment.Center; row.Parent = f
\tif T.CurrencyIcon ~= "" then
\t\tlocal i = Instance.new("ImageLabel"); i.Size = UDim2.fromOffset(T.Body, T.Body); i.BackgroundTransparency = 1; i.Image = T.CurrencyIcon; i.Parent = f
\tend
\tlocal l = Instance.new("TextLabel"); l.BackgroundTransparency = 1; l.AutomaticSize = Enum.AutomaticSize.X; l.Size = UDim2.fromOffset(0, T.Body)
\ttext(l, Kit.Abbrev(amount), T.Body, T.Colors.Accent); l.TextWrapped = false; l.Parent = f
\treturn f, function(n: number) l.Text = Kit.Abbrev(n) end
end

-- Feedback toast: kind "ok" | "error" | "info"; fades out after \`seconds\` (default 2).
function Kit.Toast(parent: Instance, message: string, kind: string?, seconds: number?)
\tlocal color = if kind == "ok" then T.Colors.Success elseif kind == "error" then T.Colors.Danger else T.Colors.Accent
\tlocal l = Instance.new("TextLabel"); l.AnchorPoint = Vector2.new(0.5, 0); l.Position = UDim2.new(0.5, 0, 0, T.Spacing * 4)
\tl.AutomaticSize = Enum.AutomaticSize.XY; l.BackgroundColor3 = T.Colors.Surface
\ttext(l, message, T.Body, color); corner(l); pad(l); l.Parent = parent
\ttask.delay(seconds or 2, function()
\t\tlocal tw = TweenService:Create(l, TweenInfo.new(0.3), { TextTransparency = 1, BackgroundTransparency = 1 })
\t\ttw.Completed:Connect(function() l:Destroy() end); tw:Play()
\tend)
end

return Kit
`;
}
