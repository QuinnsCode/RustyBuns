// Agent Office's emoji, each with the Lucide icon that stands in for it. Keys are written without the U+FE0F
// variation selector (split.ts matches with or without it). An emoji left out of here stays an emoji: the
// coloured status dots, mostly, whose colour is the whole point.
import {
  ArrowDown, ArrowDownUp, ArrowUp, ArrowUpToLine, Armchair, Asterisk, Axe, Ban, Banknote, Bean, Beer, Bell, BellOff,
  BookOpen, Bomb, Bot, Brain, BrickWall, BriefcaseBusiness, BrushCleaning, Building, BuildingComplex, Calendar, CarFront,
  Castle, Cat, Check, ChevronsUp, Cigarette, CigaretteOff, CircleAlert, CircleCheck, CircleQuestionMark, CircleX,
  ClipboardList, Clock, Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, Coffee, Command, Compass, Construction,
  CornerDownLeft, Croissant, Crown, CupSoda, Dices, Disc, Disc3, Dog, DoorOpen, Droplet, Ear, Earth, Eye,
  FaceAngry, FaceExpressionless, FaceGrinning, FaceNeutral, FaceSlightlyFrowning, FaceSlightlySmiling, FastForward,
  FileText, FireExtinguisher, Flag, FlagTriangleRight, Flame, Folder, Folders, Footprints, Gamepad2, Ghost, GitBranch,
  GitFork, GitPullRequest, GlassWater, Glasses, Globe, Hammer, Hand, HandHeart, Handshake, HardHat, Headphones, Heart,
  Highlighter, Hourglass, House, IceCreamCone, Image, Inbox, Joystick, Key, Keyboard, Laptop, Leaf, LibraryBig,
  Lightbulb, Link, Lock, LockKeyhole, Mail, MailOpen, Map, Martini, Megaphone, Menu, MessageCircle, Mic, Monitor, Moon,
  Mountain, Music, Music2, NotebookPen, OctagonX, Package, Paperclip, PartyPopper, Pause, PawPrint, Pencil, PenLine,
  PersonStanding, Pin, Plus, Pointer, Radio, Rat, RefreshCw, Repeat, Rocket, Satellite, SatelliteDish, ScrollText,
  Search, Settings, Shell, Shield, Shirt, SkipForward, Skull, Smartphone, Snowflake, Sofa, Sparkles, Speech, Sprout,
  Square, SquareTerminal, Sun, Sunset, Swords, Tag, Target, Telescope, Timer, Tornado, TowerControl, TrainFront, Trash,
  TreePalm, TreePine, TriangleAlert, Trophy, Turtle, Tv, Users, User, Vibrate, Video, Volleyball, Volume, Volume2, VolumeX,
  WavesHorizontal, Wheat, Wind, Wine, Wrench, X, Zap,
  type IconNode,
} from "lucide";

export const EMOJI: Record<string, IconNode> = {
  // the office's own furniture: PRs, worktrees, the board, the queue
  "🔀": GitPullRequest, "🌿": GitBranch, "⎇": GitBranch, "📋": ClipboardList, "📌": Pin, "🤖": Bot,
  "🧑‍💻": SquareTerminal, "🐚": Shell, "💻": Laptop, "🖥": Monitor, "⌨": Keyboard, "⌘": Command, "⏎": CornerDownLeft,
  "🛗": ArrowDownUp, "🏢": Building, "🏙": BuildingComplex, "🗂": Folders, "📁": Folder, "📄": FileText, "📝": NotebookPen,
  "✍": PenLine, "✏": Pencil, "✎": Pencil, "🖍": Highlighter, "🏷": Tag, "📎": Paperclip, "🔗": Link, "🌐": Globe,
  "🐙": GitFork, "✳": Asterisk, "🧠": Brain, "💡": Lightbulb, "🛠": Wrench, "🔨": Hammer, "🧹": BrushCleaning,
  "🖼": Image, "📚": LibraryBig, "📖": BookOpen, "📜": ScrollText, "🪧": Megaphone, "📣": Megaphone, "📯": Megaphone,
  "📅": Calendar, "🕰": Clock, "⏱": Timer, "⏳": Hourglass,
  // status and controls
  "✕": X, "✓": Check, "✔": Check, "✅": CircleCheck, "❌": CircleX, "⛔": OctagonX, "🛑": OctagonX, "🚫": Ban,
  "🙅": Ban, "⚠": TriangleAlert, "❗": CircleAlert, "❓": CircleQuestionMark, "🚧": Construction, "🏗": Construction,
  "☰": Menu, "⚙": Settings, "✨": Sparkles, "🌌": Sparkles, "➕": Plus, "🗑": Trash, "🔍": Search, "🔎": Search,
  "🔒": Lock, "🔐": LockKeyhole, "🔑": Key, "🛡": Shield, "🔄": RefreshCw, "🔁": Repeat, "⬆": ArrowUp, "⬇": ArrowDown,
  "🔝": ArrowUpToLine, "⏹": Square, "⏸": Pause, "⏩": FastForward, "⏭": SkipForward, "🎯": Target, "🏆": Trophy,
  "🎉": PartyPopper, "🚀": Rocket, "⚡": Zap, "🔥": Flame, "🕯": Flame, "💤": Moon, "💸": Banknote,
  "📥": Inbox, "✉": Mail, "📨": Mail, "📭": MailOpen, "🔔": Bell, "🔕": BellOff, "💬": MessageCircle, "🗣": Speech,
  // people
  "👥": Users, "👤": User, "🧑": User, "🧍": PersonStanding, "🕺": PersonStanding, "🚶": Footprints, "👷": HardHat,
  "🧑‍💼": BriefcaseBusiness, "🧑‍🚀": Rocket, "👑": Crown, "👔": Shirt, "🤝": Handshake, "🙋": Hand, "✋": Hand,
  "👋": Hand, "👏": Hand, "👍": Hand, "👉": Pointer, "🙏": HandHeart, "👀": Eye, "👂": Ear, "🫁": Wind,
  // voice and music
  "🎙": Mic, "🎤": Mic, "🎧": Headphones, "📻": Radio, "🔈": Volume, "🔊": Volume2, "🔇": VolumeX,
  "🎵": Music, "♪": Music2, "♫": Music, "♬": Music, "💿": Disc, "🪩": Disc3, "📺": Tv, "🎥": Video, "📱": Smartphone,
  "📡": SatelliteDish, "🛰": Satellite, "🫨": Vibrate,
  // the building and the city
  "🚪": DoorOpen, "🪑": Armchair, "🛋": Sofa, "🪜": ChevronsUp, "🧱": BrickWall, "🏠": House, "🏰": Castle,
  "🗼": TowerControl, "🚇": TrainFront, "🏎": CarFront, "🚒": FireExtinguisher, "🗺": Map, "🧭": Compass,
  "🔭": Telescope, "🌇": Sunset, "🏔": Mountain, "🏖": TreePalm, "🌍": Earth, "🌏": Earth,
  // games and the roof
  "🕹": Joystick, "🎮": Gamepad2, "🎲": Dices, "🏀": Volleyball, "⛳": FlagTriangleRight, "🏌": FlagTriangleRight,
  "🏁": Flag, "🚩": Flag, "🪓": Axe, "💣": Bomb, "⚔": Swords, "🪂": Wind, "🌀": Tornado, "🧸": Heart, "❤": Heart,
  // the bar, the kitchen, the smoking spot
  "🍸": Martini, "🍹": Martini, "🍷": Wine, "🍺": Beer, "🍻": Beer, "🥃": GlassWater, "☕": Coffee, "🍦": IceCreamCone,
  "🍞": Croissant, "🌭": CupSoda, "🫘": Bean, "🚬": Cigarette, "🚭": CigaretteOff, "💧": Droplet,
  // weather and the outdoors
  "☀": Sun, "☁": Cloud, "🌧": CloudRain, "⛈": CloudLightning, "🌨": CloudSnow, "🌫": CloudFog, "🌙": Moon,
  "🥶": Snowflake, "🌲": TreePine, "🎄": TreePine, "🌱": Sprout, "🍃": Leaf, "🍂": Leaf, "🌾": Wheat,
  "🧜": WavesHorizontal, "🐶": Dog, "🦊": Cat, "🐀": Rat, "🐢": Turtle, "🐾": PawPrint, "🎃": Ghost,
  "📦": Package, "☠": Skull, "💀": Skull,
  // moods (the chatter bubbles)
  "🙂": FaceSlightlySmiling, "😌": FaceSlightlySmiling, "🥲": FaceSlightlySmiling, "🫡": FaceSlightlySmiling,
  "😎": Glasses, "🤪": FaceGrinning, "😶": FaceNeutral, "😮": FaceNeutral, "😳": FaceNeutral, "🫠": FaceExpressionless,
  "😵": FaceExpressionless, "🥴": FaceExpressionless, "🤦": FaceExpressionless, "😩": FaceAngry,
  "😢": FaceSlightlyFrowning, "😭": FaceSlightlyFrowning, "😞": FaceSlightlyFrowning, "😰": FaceSlightlyFrowning,
  "😨": FaceSlightlyFrowning, "😱": FaceSlightlyFrowning, "🥺": FaceSlightlyFrowning,
};
