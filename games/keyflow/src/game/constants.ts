import type { Lesson, TestDef } from './types';

/** 5 字符 = 1 词。 */
export const WORDS_PER_WPM = 5;
/** 每键掌握阈值：准确率 ≥ 80%、尝试 ≥ 30 次、每键 WPM ≥ 15（参考语义）。 */
export const MASTER_ACC = 80;
export const MASTER_ATTEMPTS = 30;
export const MASTER_WPM = 15;
/** 默认 drills 数（每课行数）。 */
export const DEFAULT_DRILLS = 10;
/** Options 可选 drills 数（5 的倍数）。 */
export const DRILL_CHOICES = [5, 10, 15, 20];
export const WEEKS = 52;
/** 会话日志上限条数。 */
export const MAX_LOG = 200;

/** 64 键引入顺序 —— 课程键集 = 前缀。 */
export const LESSON_KEY_ORDER =
  "asdfjkl;eit.nro,hcpumygwvbxqz'\":?!()-4738291056=$+%&*#@<>/[]{}^_";
/** 小键盘顺序（参考语义）。 */
export const KEYPAD_ORDER = '4567891230.+';
/** 大写模式启用键索引（字母表引入完成后）。 */
export const UPPERCASE_FROM = 8;
/** home 键（焦点键优先）。 */
export const HOME_KEYS = 'asdfjkl;';

/** 特殊课程（不参与顺序推进；顺序课程由 lessonKeys(keyIndex) 动态生成）。 */
export const LESSONS: Lesson[] = [
  { id: 'keypad', name: 'Keypad Lesson', desc: 'Keypad entries: 4567891230.+', kind: 'keypad' },
  { id: 'all', name: 'All-keys', desc: 'All keys lesson', kind: 'all' },
  { id: 'finger', name: 'Finger Positioning', desc: 'Shows which finger types each key', kind: 'finger' },
];

/** 课程键集 = 引入顺序前缀（含当前键）。 */
export function lessonKeys(keyIndex: number): string {
  return LESSON_KEY_ORDER.slice(0, keyIndex + 1);
}
export function lessonName(keyIndex: number): string {
  return `Lesson ${keyIndex + 1}`;
}
export function lessonDesc(keyIndex: number): string {
  const newKey = LESSON_KEY_ORDER[keyIndex];
  const count = keyIndex + 1;
  return `New key: ${newKey} — ${count} key${count > 1 ? 's' : ''} so far`;
}

/** 键 → 手/手指（touch typing 标准指法）。 */
export interface FingerAttr {
  hand: 'left' | 'right';
  finger: 'little' | 'ring' | 'middle' | 'index' | 'thumb';
}
export const FINGER_ATTR: Record<string, FingerAttr> = {
  a: { hand: 'left', finger: 'little' },
  s: { hand: 'left', finger: 'ring' },
  d: { hand: 'left', finger: 'middle' },
  f: { hand: 'left', finger: 'index' },
  j: { hand: 'right', finger: 'index' },
  k: { hand: 'right', finger: 'middle' },
  l: { hand: 'right', finger: 'ring' },
  ';': { hand: 'right', finger: 'little' },
  q: { hand: 'left', finger: 'little' },
  w: { hand: 'left', finger: 'ring' },
  e: { hand: 'left', finger: 'middle' },
  r: { hand: 'left', finger: 'index' },
  t: { hand: 'left', finger: 'index' },
  y: { hand: 'right', finger: 'index' },
  u: { hand: 'right', finger: 'index' },
  i: { hand: 'right', finger: 'middle' },
  o: { hand: 'right', finger: 'ring' },
  p: { hand: 'right', finger: 'little' },
  z: { hand: 'left', finger: 'little' },
  x: { hand: 'left', finger: 'ring' },
  c: { hand: 'left', finger: 'middle' },
  v: { hand: 'left', finger: 'index' },
  b: { hand: 'left', finger: 'index' },
  n: { hand: 'right', finger: 'index' },
  m: { hand: 'right', finger: 'index' },
  ',': { hand: 'right', finger: 'middle' },
  '.': { hand: 'right', finger: 'ring' },
  '/': { hand: 'right', finger: 'little' },
  "'": { hand: 'right', finger: 'little' },
  '1': { hand: 'left', finger: 'little' },
  '2': { hand: 'left', finger: 'ring' },
  '3': { hand: 'left', finger: 'middle' },
  '4': { hand: 'left', finger: 'index' },
  '5': { hand: 'left', finger: 'index' },
  '6': { hand: 'right', finger: 'index' },
  '7': { hand: 'right', finger: 'index' },
  '8': { hand: 'right', finger: 'middle' },
  '9': { hand: 'right', finger: 'ring' },
  '0': { hand: 'right', finger: 'little' },
  '-': { hand: 'right', finger: 'little' },
  '=': { hand: 'right', finger: 'little' },
  '[': { hand: 'right', finger: 'little' },
  ']': { hand: 'right', finger: 'little' },
  '\\': { hand: 'right', finger: 'little' },
  '`': { hand: 'left', finger: 'little' },
  ' ': { hand: 'right', finger: 'thumb' },
};

/** 新键引入文案：手 → 手指 → 键。 */
export function fingerText(key: string): string {
  const attr = FINGER_ATTR[key.toLowerCase()];
  if (!attr) return '';
  return `Reach for '${key}' with the ${attr.finger} finger of the ${attr.hand} hand.`;
}

/** 初始测试文本（评估打字水平用）。 */
export const INITIAL_TEST_TEXT: string =
  'the quick brown fox jumps over the lazy dog ' +
  'now is the time for all good men to come to the aid of their country ' +
  'pack my box with five dozen liquor jugs ' +
  'how vexingly quick daft zebras jump ' +
  'the five boxing wizards jump quickly';

/** 固定文本测试（`useKeyFlow.startTest` 按 `id` 取用，文本单源）。
 *  Practice / Keypad 测试由生成器产出（当前键集 / `KEYPAD_ORDER`），不在此表。 */
export const TESTS: TestDef[] = [
  { id: 'all', name: 'All-keys Test', text: 'abcdefghijklmnopqrstuvwxyz 1234567890 the quick brown fox jumps over the lazy dog pack my box with five dozen liquor jugs how vexingly quick daft zebras jump' },
];

export const INTRO_PAGES: string[] = [
  'Welcome to KeyFlow!\n\n' +
    'KeyFlow drills a few keys at a time until the whole keyboard feels automatic.\n\n' +
    'You start on the left hand home keys: A S D F.\n' +
    'Little finger on A, ring finger on S, middle finger on D, index finger on F.\n\n' +
    'The right hand rests on J K L ;\n' +
    'Index finger on J, middle on K, ring on L, little finger on ;.',
  'While you type, the marker under the line shows the key to press next.\n' +
    'A wrong key turns red in the line below and typing carries on from there,\n' +
    'so a mistake never stops the lesson.\n\n' +
    'Short sessions on most days work better than one long one.\n' +
    'Set a target under Options and the reports will track it for you.',
  'The Main Menu holds five sections - Lessons, Tests, Reports and Options, plus\n' +
    'Help - and Quit to leave.\n\n' +
    'Move the highlight with ↑ / ↓ (or W and S) and press Enter or Space to pick.\n' +
    'Esc goes back one screen; the toolbar at the top always offers Back and\n' +
    'Main Menu.',
];

export const MAIN_ITEMS: string[] = [
  'Lessons', 'Tests', 'Reports', 'Options', 'Help', 'Quit',
];
export const MAIN_DESCS: string[] = [
  'Lessons: practice lessons and finger positioning',
  'Tests: measure your speed and accuracy on different key sets',
  'Reports: view progress, speed and accuracy reports',
  'Options: change goals and lesson settings',
  'Help: information about this program',
  'Quit: save session and exit KeyFlow',
];

export const OPT_ITEMS: string[] = [
  'Change speed goal', 'Adjust practice goal', 'Change accuracy goal',
  'Change number of drills', 'Edit profile', 'Reset profile',
  'Retake initial test', 'Review the introduction',
];
export const OPT_DESCS: string[] = [
  'Set your target typing speed (WPM)',
  'Set your weekly practice goal (minutes)',
  'Set your target accuracy (%)',
  'Set how many lines a lesson contains (5/10/15/20)',
  'Change your name and date',
  'Clear your profile and start over',
  'Redo the initial speed test',
  'Review the introduction',
];

/** Help 屏文本（菜单与操作说明，可翻页）。 */
export const HELP_PAGES: string[] = [
  'KeyFlow has a Main Menu and five sections: Lessons, Tests, Reports,\n' +
    'Options and Help.\n\n' +
    'Lessons: practice the keys of your current lesson, or pick a special\n' +
    'lesson (Keypad, All-keys, Finger Positioning).\n\n' +
    'Tests: measure speed and accuracy on the current lesson keys, on every\n' +
    'key, or on the numeric keypad.',
  'Reports: progress, speed and accuracy reports, each with a chart per\n' +
    'session and a list of recent sessions.\n\n' +
    'Options: set your speed, practice and accuracy goals, choose how many\n' +
    'drills a lesson contains, edit your profile, or reset it.\n\n' +
    'Move the highlight with ↑ / ↓ (or W and S), choose with Enter or Space, and\n' +
    'press Esc to go back.',
];
