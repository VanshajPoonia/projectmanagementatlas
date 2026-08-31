// The complete user guide for agile mode, as pure data.
//
// ⚠️ One copy, three surfaces: the ⓘ dialog beside the Agile heading, the same dialog on
// Super Admin > Modules, and the /agile empty state a new board lands on. Prose duplicated by
// hand across surfaces is how a help page ends up describing a product that no longer exists,
// and this repo has paid for that shape more than once.
//
// It lives entirely in the app, deliberately. A guide kept as a separate document is one more
// thing to remember to update, and it is never open at the moment somebody has the question.

export interface GuideSection {
  id: string
  heading: string
  /** One or two sentences. The point of the section, before any detail. */
  body: string
  /** Numbered when order matters (setup), bulleted when it does not. */
  steps?: string[]
  ordered?: boolean
  /** The caveat somebody hits on day two. */
  note?: string
}

export interface GuideQuestion {
  q: string
  a: string
}

export const AGILE_GUIDE = {
  title: 'Agile mode',
  tagline:
    'A planning layer for the boards that want one. Everything below is optional, per board, ' +
    'and reversible.',

  /** The short version, shown before the sections and used as the dialog description. */
  summary:
    'Agile mode adds a backlog, work planned into named windows of time, and honest numbers ' +
    'about what actually got delivered. It applies only to the boards that opt in, and it ' +
    'never changes the work itself.',

  sections: [
    {
      id: 'what-it-is',
      heading: 'What it is',
      body:
        'An ordinary board answers "what is everyone doing". Agile mode adds a second question: ' +
        '"what did we commit to for the next two weeks, and did we deliver it". It gives a board ' +
        'three things it does not otherwise have.',
      steps: [
        'A backlog: everything not yet planned into a window, in priority order.',
        'Windows: a named, dated block of work (you choose whether to call it a sprint, a cycle or an iteration).',
        'Metrics: what a finished window actually delivered, frozen so it cannot change afterwards.',
      ],
      note:
        'It is not a second product and not a second copy of your work. There is no separate ' +
        'story list to keep in sync.',
    },
    {
      id: 'changes-no-board',
      heading: 'Switching the module on changes no board',
      body:
        'This is the one thing worth reading twice, because every other module in this workspace ' +
        'behaves differently. Turning Agile on in Super Admin only makes the Agile page reachable. ' +
        'Every board carries on exactly as before until an admin turns agile on for that specific ' +
        'board.',
      note:
        'So a marketing, contracting, real estate, finance or operations board never has this ' +
        'vocabulary put in front of it. That is deliberate, and it is why the switch is in two ' +
        'places rather than one.',
    },
    {
      id: 'same-work',
      heading: 'It is the same work, not a copy',
      body:
        'A backlog item is an ordinary task on an ordinary board. Planning it into a window does ' +
        'not duplicate it, move it, or take it off the board. Opening one from the Agile page ' +
        'opens the same task detail the board uses, with the same comments, attachments and history.',
      note:
        'Nothing can drift out of sync between the board and the Agile page, because there is ' +
        'only one of everything.',
    },
    {
      id: 'set-up',
      heading: 'Setting up a board',
      body: 'Two minutes, and reversible at any point.',
      ordered: true,
      steps: [
        'Open Agile from the sidebar and pick the board from the board picker.',
        'Press Turn on agile for this board (or open Settings if you want to change more than the switch).',
        'Choose the noun: sprint, cycle or iteration. Every label on the page follows this choice.',
        'Choose the unit work is sized in: points, hours or days.',
        'Optionally set a capacity for each window, and a work-in-progress limit on any board column.',
      ],
      note:
        'Changing the noun or the unit later needs no migration and destroys nothing. Turning ' +
        'agile back off leaves the board exactly as it was, with all its tasks intact.',
    },
    {
      id: 'backlog',
      heading: 'The backlog',
      body:
        'Everything on the board that is not currently planned into a window. It is ordered, ' +
        'searchable and filterable, and you can act on many items at once.',
      steps: [
        'Order it with Move to top, up, down or bottom on any item. Ordering is offered only when the list is unfiltered, because position 3 of a filtered list is not position 3 of the real order.',
        'Add work without leaving the page with quick create.',
        'Put a size on an item inline. Leaving it unsized is fine and is reported honestly (see The numbers).',
        'Select several items and plan, size or move them together.',
      ],
      note:
        'Epics and features are just parent tasks. A parent groups its children into a swimlane; ' +
        'there is no separate epic object to maintain.',
    },
    {
      id: 'planning',
      heading: 'Planning a window',
      body:
        'Create a window with a name, a goal and a date range, then move work into it from the ' +
        'backlog. A window has four states: planned, active, completed and cancelled.',
      steps: [
        'While a window is planned you can add and remove work freely. Nothing is counted yet.',
        'Starting it stamps what was committed. That set is what the end-of-window numbers are measured against.',
        'If you set a capacity, the planning pane shows how full the window is as you add work. By default it warns and still lets you add: it does not block.',
        'Unfinished work carries over with Move to another window, in one action, so it never belongs to nothing in between.',
      ],
      note:
        'A subtask cannot be planned into a window on its own. Its parent already carries it, and ' +
        'counting both would double every estimate.',
    },
    {
      id: 'running',
      heading: 'Running the window',
      body:
        'The taskboard shows the window\'s work in the board\'s own columns, grouped into swimlanes ' +
        'by parent where there is one.',
      steps: [
        'A column can carry a work-in-progress limit. The header shows a WIP badge counting current against limit.',
        'By default a limit warns and lets the move through. A board can be switched to enforcement, where the database itself refuses the move.',
        'Where enforcement is not actually installed, the badge says "warning only, nothing is refused" rather than promising a refusal that will not happen.',
      ],
      note:
        'A warning that turns out to be untrue is how people learn to ignore the next one, which ' +
        'is why the badge tells you which of the two you are looking at.',
    },
    {
      id: 'numbers',
      heading: 'The numbers, and why they can be trusted',
      body:
        'While a window is open its numbers are live and labelled live. The moment it closes they ' +
        'are frozen. Re-estimating work, re-organising a board or renaming a status later cannot ' +
        'quietly rewrite what a finished window delivered.',
      steps: [
        'Committed: what was in the window when it started.',
        'Completed: what actually finished.',
        'Added and removed after start: how much the plan moved underneath you.',
        'Unestimated: items with no size, reported as their own number and never counted as zero.',
        'Velocity: the average delivered across finished windows. A window counted in hours is never averaged into a points velocity; it is excluded, and the exclusion is listed on screen.',
        'Burndown: work remaining per day. A day with no sample is drawn as a gap, never as zero, because a gap drawn as zero looks like the team finished everything overnight.',
      ],
      note:
        'Every figure shows what it counted and what it left out. If a closed window has no ' +
        'stored record, the page says so rather than recomputing a number that would change ' +
        'every time you looked at it.',
    },
    {
      id: 'who-can',
      heading: 'Who can change what',
      body:
        'Three levels, and the day-to-day one is deliberately wide. Nothing about running a ' +
        'window needs the owner.',
      steps: [
        'Super admin: switches the whole agile module on or off for the workspace, in Super Admin. Nothing else here needs that level.',
        'Any admin: turns agile on for a particular board, picks its noun and unit, sets a window capacity, and sets a column\'s work-in-progress limit.',
        'Everyone else: creates and runs windows, adds to the backlog, orders it, sizes items and plans them in.',
      ],
      note:
        'Guests and clients on a board stay read-only here exactly as they are everywhere else, ' +
        'so opening agile on a board shared with a client changes nothing about what they can do.',
    },
    {
      id: 'turning-off',
      heading: 'Turning it off',
      body:
        'Switch agile off for a board and it becomes an ordinary board again immediately. No task ' +
        'is deleted, moved or changed. Switch the module off in Super Admin and the Agile page ' +
        'disappears for everyone, with the same guarantee.',
      note:
        'Windows and their frozen numbers are kept, so turning it back on later restores the ' +
        'history rather than starting from nothing.',
    },
  ] as GuideSection[],

  faq: [
    {
      q: 'Do we have to say "sprint"?',
      a: 'No. Each board chooses sprint, cycle or iteration, and every label on the page follows that choice. Changing it later is a setting, not a migration.',
    },
    {
      q: 'Will this change our other boards?',
      a: 'No. Agile is off for every board until an admin turns it on for that board specifically. Turning the module on only makes the page reachable.',
    },
    {
      q: 'Do we have to estimate everything?',
      a: 'No. Unsized items are counted as unestimated and reported as their own number. They are never treated as zero, because a plan that reads "12 of 20 points" while carrying six unsized items is the most common way a burndown flatters.',
    },
    {
      q: 'Can we size work in hours instead of points?',
      a: 'Yes, per board: points, hours or days. The stored value carries no unit, so switching needs no data migration.',
    },
    {
      q: 'What happens to work we do not finish?',
      a: 'Nothing automatic. Move it to another window in one action, or send it back to the backlog. The closed window keeps an honest record of what it did and did not deliver.',
    },
    {
      q: 'Can a subtask go into a window on its own?',
      a: 'No. Its parent already carries it, and counting both would double-count every estimate in the burndown.',
    },
    {
      q: 'What is the difference between warning and enforcement?',
      a: 'A warning shows the limit is exceeded and lets the move through. Enforcement means the database refuses it. Where enforcement is not installed the badge says so, so a limit never promises something it cannot deliver.',
    },
    {
      q: 'Who can do what?',
      a: 'Three levels. A super admin switches the whole module on or off for the workspace, in Super Admin. Any admin turns agile on for a particular board and sets its noun, its unit, its capacity and a column\'s work-in-progress limit. Everyone else can do the day-to-day work: create and run windows, add to the backlog, order it, estimate items and plan them in. Guests and clients on a board stay read-only, exactly as they are everywhere else.',
    },
    {
      q: 'Does the owner have to be involved in day-to-day use?',
      a: 'No. Only two things need a super admin: switching the module on for the workspace, and it is already on. Everything after that, including turning agile on for a board and setting limits, is an ordinary admin action.',
    },
  ] as GuideQuestion[],
} as const
