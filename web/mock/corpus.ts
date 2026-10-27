/** Public-domain text (Lewis Carroll, 1865; Jane Austen, 1813) used to build mock documents. */

export const ALICE_CHAPTERS = [
  "Down the Rabbit-Hole",
  "The Pool of Tears",
  "A Caucus-Race and a Long Tale",
  "The Rabbit Sends in a Little Bill",
  "Advice from a Caterpillar",
  "Pig and Pepper",
  "A Mad Tea-Party",
  "The Queen's Croquet-Ground",
  "The Mock Turtle's Story",
  "The Lobster Quadrille",
  "Who Stole the Tarts?",
  "Alice's Evidence",
];

export const ALICE_PARAGRAPHS = [
  "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, “and what is the use of a book,” thought Alice “without pictures or conversations?”",
  "So she was considering in her own mind (as well as she could, for the hot day made her feel very sleepy and stupid), whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.",
  "There was nothing so very remarkable in that; nor did Alice think it so very much out of the way to hear the Rabbit say to itself, “Oh dear! Oh dear! I shall be late!” (when she thought it over afterwards, it occurred to her that she ought to have wondered at this, but at the time it all seemed quite natural); but when the Rabbit actually took a watch out of its waistcoat-pocket, and looked at it, and then hurried on, Alice started to her feet, for it flashed across her mind that she had never before seen a rabbit with either a waistcoat-pocket, or a watch to take out of it, and burning with curiosity, she ran across the field after it, and fortunately was just in time to see it pop down a large rabbit-hole under the hedge.",
  "In another moment down went Alice after it, never once considering how in the world she was to get out again.",
  "The rabbit-hole went straight on like a tunnel for some way, and then dipped suddenly down, so suddenly that Alice had not a moment to think about stopping herself before she found herself falling down a very deep well.",
  "Either the well was very deep, or she fell very slowly, for she had plenty of time as she went down to look about her and to wonder what was going to happen next. First, she tried to look down and make out what she was coming to, but it was too dark to see anything; then she looked at the sides of the well, and noticed that they were filled with cupboards and book-shelves; here and there she saw maps and pictures hung upon pegs.",
  "Down, down, down. Would the fall never come to an end? “I wonder how many miles I’ve fallen by this time?” she said aloud. “I must be getting somewhere near the centre of the earth. Let me see: that would be four thousand miles down, I think—” (for, you see, Alice had learnt several things of this sort in her lessons in the schoolroom, and though this was not a very good opportunity for showing off her knowledge, as there was no one to listen to her, still it was good practice to say it over).",
  "“Curiouser and curiouser!” cried Alice (she was so much surprised, that for the moment she quite forgot how to speak good English); “now I’m opening out like the largest telescope that ever was! Good-bye, feet!” (for when she looked down at her feet, they seemed to be almost out of sight, they were getting so far off).",
  "Alice opened the door and found that it led into a small passage, not much larger than a rat-hole: she knelt down and looked along the passage into the loveliest garden you ever saw. How she longed to get out of that dark hall, and wander about among those beds of bright flowers and those cool fountains, but she could not even get her head through the doorway.",
  "It was all very well to say “Drink me,” but the wise little Alice was not going to do that in a hurry. “No, I’ll look first,” she said, “and see whether it’s marked ‘poison’ or not”; for she had read several nice little histories about children who had got burnt, and eaten up by wild beasts and other unpleasant things, all because they would not remember the simple rules their friends had taught them.",
  "The Caterpillar and Alice looked at each other for some time in silence: at last the Caterpillar took the hookah out of its mouth, and addressed her in a languid, sleepy voice. “Who are you?” said the Caterpillar. This was not an encouraging opening for a conversation.",
  "There was a table set out under a tree in front of the house, and the March Hare and the Hatter were having tea at it: a Dormouse was sitting between them, fast asleep, and the other two were using it as a cushion, resting their elbows on it, and talking over its head.",
];

export const ALICE_QUOTES = [
  "How doth the little crocodile improve his shining tail, and pour the waters of the Nile on every golden scale!",
  "Twinkle, twinkle, little bat! How I wonder what you’re at! Up above the world you fly, like a tea-tray in the sky.",
];

export const ALICE_LIST = [
  "a rabbit with a waistcoat-pocket,",
  "a little bottle that said “Drink me”,",
  "a very small cake, on which the words “Eat me” were beautifully marked in currants.",
];

export const AUSTEN_PARAGRAPHS = [
  "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.",
  "However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.",
  "“My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?” Mr. Bennet replied that he had not.",
  "“But it is,” returned she; “for Mrs. Long has just been here, and she told me all about it.” Mr. Bennet made no answer. “Do you not want to know who has taken it?” cried his wife impatiently. “You want to tell me, and I have no objection to hearing it.” This was invitation enough.",
  "Mr. Bennet was so odd a mixture of quick parts, sarcastic humour, reserve, and caprice, that the experience of three-and-twenty years had been insufficient to make his wife understand his character. Her mind was less difficult to develop. She was a woman of mean understanding, little information, and uncertain temper.",
  "Mr. Bennet was among the earliest of those who waited on Mr. Bingley. He had always intended to visit him, though to the last always assuring his wife that he should not go; and till the evening after the visit was paid she had no knowledge of it.",
];

export const NOTES_BLOCKS: { kind: "title" | "heading" | "paragraph" | "list_item" | "quote"; level?: number; text: string }[] = [
  { kind: "title", level: 1, text: "Garden planning notes" },
  { kind: "paragraph", text: "These notes collect the plan for the spring beds, what worked last year, and the order in which the work should happen once the soil is workable again." },
  { kind: "heading", level: 2, text: "What worked last year" },
  { kind: "list_item", text: "Sweet peas along the south fence, sown early and pinched out at four leaves." },
  { kind: "list_item", text: "A thick mulch of leaf mould on the shady border, which kept the ferns happy through August." },
  { kind: "list_item", text: "Watering in the early morning rather than the evening, which cut the slug damage noticeably." },
  { kind: "heading", level: 2, text: "Order of work" },
  { kind: "paragraph", text: "Start with the structural jobs while the plants are dormant: edging, paths and the new raised bed by the shed. Then lift and divide the crowded perennials, and finally sow the annuals in modules under cover so they are ready to plant out after the last frost." },
  { kind: "quote", text: "The best time to plant a tree was twenty years ago. The second best time is now." },
  { kind: "heading", level: 3, text: "Open questions" },
  { kind: "paragraph", text: "Whether to move the compost bins closer to the kitchen, and whether the old apple tree needs a proper winter prune or just the dead wood taken out." },
];
