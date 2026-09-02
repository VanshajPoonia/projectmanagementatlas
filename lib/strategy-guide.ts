// The complete user guide for the strategy module, as pure data.
//
// ⚠️ One copy, three surfaces: the ⓘ beside the Strategy heading, the same dialog on
// Super Admin > Modules where somebody decides whether to switch it on, and the empty state a
// workspace with no goals lands on. Prose duplicated by hand across surfaces is how a help
// page ends up describing a product that no longer exists.
//
// It lives entirely in the app, deliberately. A guide kept as a separate document is one more
// thing to remember to update, and it is never open at the moment somebody has the question.
//
// ⚠️ NON-JARGONY IS A REQUIREMENT, not a preference. Prompt H's second line is "keep it
// optional and non-jargony", and Leantime's stated philosophy - which this module is modelled
// on - is that it is built for people who are not project managers. So: "what a project is
// for", not "charter"; "did the number move", not "OKR attainment"; "a short look back", not
// "ceremony". Where a standard word genuinely helps somebody search for it (SWOT,
// retrospective) it is used and then explained.

import type { ProductGuide } from './product-guide'

export const STRATEGY_GUIDE: ProductGuide = {
  title: 'Strategy',
  tagline:
    'Why the work exists, what it is meant to change, and what you learned afterwards. All of ' +
    'it optional, none of it required to run a board.',

  summary:
    'Strategy is one page holding five things that normally live in somebody\'s head or a ' +
    'spreadsheet: what each project is for, the goals you are trying to move, ideas before ' +
    'they become work, a SWOT, and short reviews after something finishes. It changes nothing ' +
    'about your boards or your tasks - it sits alongside them and links to them.',

  sections: [
    {
      id: 'what-it-is',
      heading: 'What this page is',
      body:
        'Five tabs, each answering a question a task list cannot. You can use one of them and ' +
        'ignore the rest; nothing here depends on anything else here.',
      steps: [
        'Goals - the numbers you are trying to move, and how far they have moved.',
        'Ideas - things worth doing, before anybody has committed to doing them.',
        'Purpose - what a particular project is for, and what it is deliberately not doing.',
        'SWOT - the honest picture of where the business or a project stands.',
        'Reviews - a short look back after something finishes, and the actions that come out of it.',
      ],
    },
    {
      id: 'changes-nothing',
      heading: 'It changes nothing about your boards',
      body:
        'Switching this module on adds one page to the sidebar. No board, column, task, due ' +
        'date, assignment or report changes in any way, and nobody is asked to fill anything ' +
        'in. If nobody ever opens it, nothing about the workspace is different.',
      note:
        'The one place it reaches into your existing work is by choice: you can link a goal to ' +
        'a project or a task, and you can turn an idea or a review action into a real work ' +
        'item. Both create ordinary tasks on ordinary boards - there is no second, parallel ' +
        'to-do list anywhere in here.',
    },
    {
      id: 'goals',
      heading: 'Goals: the number you are trying to move',
      body:
        'A goal is a thing you want to be true, with a measurement attached. "Cut callbacks ' +
        'from 12 a month to 4 by December" is a goal. So is "sign 30 new clients this year".',
      steps: [
        'Give it a title and, if you have one, a measurement: what you are counting, the unit, where it started, where it is now, and where you want it.',
        'Set who owns it. That person can update the number without needing an admin.',
        'Link the projects and work items that are meant to move it.',
        'Update the current number whenever you know it, with a sentence about what changed.',
      ],
      note:
        'A goal with no numbers is still a goal. If what you want cannot be counted, leave the ' +
        'measurement blank and use health and confidence instead - the page will not pretend ' +
        'to have a percentage it does not have.',
    },
    {
      id: 'execution-vs-outcome',
      heading: 'Two progress figures, and why they are never combined',
      body:
        'Every goal shows two separate numbers, and the whole design of this page exists to ' +
        'keep them apart. Work done is how much of the linked work is finished. Result is how ' +
        'far the measurement has actually moved. They are not the same thing and one does not ' +
        'predict the other.',
      steps: [
        'Work done at 100% and Result at 0% means you did everything you planned and it did not work. That is the most useful thing this page can tell you, and a single blended percentage would hide it completely.',
        'Result climbing while Work done sits low means something other than your plan is moving the number - worth understanding before you credit the plan.',
        'When the two disagree badly, the page says so in words rather than leaving you to spot it.',
      ],
      note:
        'This is why there is no single "goal progress" bar anywhere in the product. A project ' +
        'can finish every task and still fail its outcome, and a number that averages the two ' +
        'is the one number guaranteed to be wrong.',
    },
    {
      id: 'checkins',
      heading: 'Every measurement is kept',
      body:
        'When you change a goal\'s current value, confidence or health, the previous reading is ' +
        'recorded automatically along with your note. Nothing overwrites history.',
      note:
        'That record cannot be edited or deleted by anyone, including admins - not a rule the ' +
        'screen enforces, something the database will not allow. It is what makes "the number ' +
        'has not moved since June" an answerable question rather than an argument.',
    },
    {
      id: 'ideas',
      heading: 'Ideas: things worth doing, before they are work',
      body:
        'Anyone in the workspace can write down an idea. It sits in a pipeline - captured, ' +
        'being reviewed, being researched, validated - until somebody decides. Nothing is ' +
        'forced through in order; you can move an idea straight to validated if it is obvious.',
      steps: [
        'Capture takes a title. Everything else - the problem, who it is for, the evidence, the expected value - is optional and can be filled in later.',
        'Add research as notes on the idea. They stay attached to it forever.',
        'When it is ready, turn it into a project or a work item. The idea itself does not move; it gains a link to what it became.',
        'When you say no, you record why. Six months later that reason is the only thing stopping the same idea coming back from scratch.',
      ],
      note:
        'Rejected and Parked are different endings on purpose. Rejected is a decision with a ' +
        'reason. Parked is "not now, and nothing decided against it" - use it for the things ' +
        'you genuinely might come back to.',
    },
    {
      id: 'impact-effort',
      heading: 'Impact and effort',
      body:
        'If you score an idea for impact and effort, it appears on a four-box grid: quick ' +
        'wins, big bets, fill-ins and time sinks. It is a way of looking at the ideas you ' +
        'already have, not a separate thing to maintain.',
      note:
        'Ideas you have not scored are listed on their own and never placed in a box. Putting ' +
        'an unscored idea in "time sinks" because two fields were blank is an accusation the ' +
        'data does not support.',
    },
    {
      id: 'purpose',
      heading: 'Purpose: what a project is for',
      body:
        'Eight optional boxes on a board: the problem, the purpose, the intended outcome, who ' +
        'the stakeholders are, who it is for, what success looks like, the constraints, and ' +
        'what it is deliberately not doing. Fill in one, or all of them, or none.',
      note:
        'The one most people skip is Non-goals, and it is the one that later prevents the most ' +
        'argument. "We are not redesigning the website as part of this" written down in March ' +
        'settles a conversation in September.',
    },
    {
      id: 'swot',
      heading: 'SWOT',
      body:
        'Four lists: what you are good at, what you are not, what is changing outside that you ' +
        'could use, and what is changing outside that could hurt. Write it for the whole ' +
        'company or for one project.',
      note:
        'It is four lists, not a diagram. There is no drawing canvas here on purpose - a ' +
        'whiteboard would add an engine and no information, and this stays something you can ' +
        'read in twenty seconds.',
    },
    {
      id: 'reviews',
      heading: 'Reviews: a short look back',
      body:
        'Pick a board, pick a template, and everyone adds short notes about how something ' +
        'went. Vote on the ones that matter, gather related notes into themes, and turn the ' +
        'agreed actions into real work items.',
      steps: [
        'Four templates: what went well, start/stop/continue, the four Ls, or one plain list. Pick whichever suits the conversation.',
        'Voting is one vote per person per note, and who voted is never shown to anyone.',
        'Grouping is where the value is: five people writing slightly different sentences about the same problem reads as five weak signals until you gather them.',
        'Actions become ordinary tasks on the board, so they show up in My Work like everything else instead of being forgotten in a document.',
        'Closing a review freezes it. The notes and votes become the record of what was said.',
      ],
    },
    {
      id: 'anonymity',
      heading: 'Anonymous reviews, and exactly what that promises',
      body:
        'A review can be anonymous. When it is, nobody can look up who wrote a note - not ' +
        'other participants, not admins, and not by querying the database, because the ' +
        'information is not stored anywhere they can reach. You can still edit and delete ' +
        'your own notes.',
      note:
        'One thing no setting can fix: if people are watching the board while notes appear, ' +
        'the order they appear in can give someone away. If that matters, ask people to write ' +
        'their notes before the session rather than during it. Also note that whether a review ' +
        'is anonymous is fixed when it is created - it cannot be switched afterwards, because ' +
        'people wrote under the rule that was in force at the time.',
    },
    {
      id: 'who-can',
      heading: 'Who can change what',
      body:
        'Most of this is open to everyone, deliberately. An idea box only half the company can ' +
        'reach collects half the ideas.',
      steps: [
        'Anyone signed in: capture an idea, add research to one, read every goal and its history.',
        'Anyone on a board, except guests and clients: run a review, write notes, vote, add actions.',
        'A goal\'s owner: update that goal\'s number, confidence and health, and link work to it.',
        'Any admin: create and delete goals, write a project\'s purpose, edit the SWOT, move any idea through the pipeline.',
        'A super admin: switch the whole module on or off, in Super Admin then Modules.',
      ],
      note:
        'Guests and clients stay read-only, exactly as they are everywhere else. They can see ' +
        'a review on a board they have access to; they cannot write in it.',
    },
    {
      id: 'turning-off',
      heading: 'Turning it off',
      body:
        'A super admin can switch the module off in Super Admin then Modules. The page ' +
        'disappears from everyone\'s sidebar and the workspace is exactly as it was before.',
      note:
        'Nothing is deleted when you switch it off. Every goal, idea, review and measurement ' +
        'is still there if you switch it back on.',
    },
  ],

  faq: [
    {
      q: 'Do we have to use all of it?',
      a: 'No. The five tabs are independent. Plenty of workspaces would use Reviews and nothing else, or Goals and nothing else.',
    },
    {
      q: 'Why are there two progress numbers on a goal?',
      a: 'Because finishing the work and getting the result are different things, and one number covering both hides the case you most need to see: everything done, nothing changed.',
    },
    {
      q: 'Our goal has nothing to count. Can we still use it?',
      a: 'Yes. Leave the measurement blank and set health and confidence by hand. The page shows "no target set" rather than inventing a percentage.',
    },
    {
      q: 'Who decides whether a goal is on track?',
      a: 'A person does. Health is never calculated here. A goal can be 80% of the way to its number and off track because the last 20% is the hard part, and no formula knows that.',
    },
    {
      q: 'What happens to an idea when we turn it into work?',
      a: 'A normal task or board is created, and the idea gains a link to it. The idea stays where it is with all its research, so the reasoning behind a piece of work survives the moment it becomes a ticket.',
    },
    {
      q: 'Can I edit my own anonymous note?',
      a: 'Yes, and delete it. The system knows it is yours without being able to tell anybody else.',
    },
    {
      q: 'Can an admin read who wrote an anonymous note?',
      a: 'No. There is no screen, query or export that answers it, because the link is not stored anywhere an admin\'s account can reach.',
    },
    {
      q: 'Can we make an existing review anonymous?',
      a: 'No, in either direction. People wrote under the rule that was in force at the time, and there is no undo for exposing them. Start a new review instead.',
    },
    {
      q: 'Does the owner have to be involved day to day?',
      a: 'No. Only switching the module on or off needs a super admin. Everything after that is ordinary admin or member work.',
    },
    {
      q: 'Will this show up on our boards?',
      a: 'Only where you ask it to. Linking a goal to a task does not change the task, and a review action becomes an ordinary work item you can see and move like any other.',
    },
    {
      q: 'What is a SWOT, in plain terms?',
      a: 'Four questions. What are we good at, what are we not good at, what is happening outside that we could use, and what is happening outside that could hurt us. The first two are about you; the last two are not.',
    },
  ],
}
