// The lucide icons the Controls panel uses. Words change per language, these don't, so every section, row and
// profile slot carries one. A new row's icon is added here, then named in schema.ts.
import { Accessibility, Camera, Captions, ChevronDown, ChevronsDownUp, ChevronsUpDown, Contrast, Crosshair, Ear, Eye, Feather, Gamepad2, Gauge, Hand, Keyboard, Mouse, MoveHorizontal, MoveVertical, Music, Puzzle, Smartphone, Sun, Timer, Vibrate, Volume2, Waves, Zap } from "lucide";

export const ICONS = { Accessibility, Camera, Captions, ChevronDown, ChevronsDownUp, ChevronsUpDown, Contrast, Crosshair, Ear, Eye, Feather, Gamepad2, Gauge, Hand, Keyboard, Mouse, MoveHorizontal, MoveVertical, Music, Puzzle, Smartphone, Sun, Timer, Vibrate, Volume2, Waves, Zap };
export type IconName = keyof typeof ICONS;
