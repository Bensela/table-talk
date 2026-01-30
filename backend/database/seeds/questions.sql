-- Clear existing questions to avoid duplicates if re-seeding
TRUNCATE TABLE questions RESTART IDENTITY;

-- Exploring (Getting to Know You / Easy)
INSERT INTO questions (question_text, answer_text, context, difficulty, question_type) VALUES
('If you could have dinner with anyone dead or alive, who and why?', 'Think about: what would you want to learn from them?', 'Exploring', 'easy', 'open-ended'),
('What is your favorite way to spend a weekend?', 'Do you prefer adventure or relaxation?', 'Exploring', 'easy', 'open-ended'),
('What was the last book or movie that really moved you?', 'Why did it resonate with you?', 'Exploring', 'easy', 'open-ended'),
('If you could travel anywhere tomorrow, where would you go?', 'What draws you to that place?', 'Exploring', 'easy', 'open-ended'),
('What is one hobby you have always wanted to pick up?', 'What has stopped you so far?', 'Exploring', 'easy', 'open-ended'),
('What is your go-to comfort food?', 'Is there a memory attached to it?', 'Exploring', 'easy', 'open-ended'),
('Who has been the biggest influence on your life?', 'In what way did they shape you?', 'Exploring', 'easy', 'open-ended'),
('What is the best piece of advice you have ever received?', 'Did you follow it?', 'Exploring', 'easy', 'open-ended'),
('If you could master one skill instantly, what would it be?', 'How would you use it?', 'Exploring', 'easy', 'open-ended'),
('What is your earliest childhood memory?', 'How does it make you feel now?', 'Exploring', 'easy', 'open-ended'),
('What is something that always makes you laugh?', 'Why do you find it funny?', 'Exploring', 'easy', 'open-ended'),
('If you could live in any era, which one would you choose?', 'What appeals to you about that time?', 'Exploring', 'easy', 'open-ended'),
('What is your biggest pet peeve?', 'Why does it bother you?', 'Exploring', 'easy', 'open-ended'),
('What is one thing you are really proud of?', 'What did it take to achieve it?', 'Exploring', 'easy', 'open-ended'),
('If you could trade lives with someone for a day, who would it be?', 'What would you do in their shoes?', 'Exploring', 'easy', 'open-ended');

-- Established (Hypotheticals / Medium)
INSERT INTO questions (question_text, answer_text, context, difficulty, question_type) VALUES
('If we could drop everything and move to another country, where would we go?', 'How would our lives change?', 'Established', 'medium', 'open-ended'),
('What is one meaningful tradition you want us to start?', 'Why is it important to you?', 'Established', 'medium', 'open-ended'),
('If money were no object, what would our ideal day look like?', 'What would we do together?', 'Established', 'medium', 'open-ended'),
('What is one thing you admire most about me?', 'How does it inspire you?', 'Established', 'medium', 'open-ended'),
('When do you feel most loved by me?', 'What specific actions trigger that feeling?', 'Established', 'medium', 'open-ended'),
('What is a challenge we have overcome that made us stronger?', 'What did we learn from it?', 'Established', 'medium', 'open-ended'),
('If you could change one thing about our daily routine, what would it be?', 'How would it improve our lives?', 'Established', 'medium', 'open-ended'),
('What is your favorite memory of us together?', 'What makes it stand out?', 'Established', 'medium', 'open-ended'),
('If we started a business together, what would it be?', 'What roles would we each play?', 'Established', 'medium', 'open-ended'),
('What is one goal you want us to achieve in the next year?', 'How can we support each other?', 'Established', 'medium', 'open-ended'),
('How have we changed since we first met?', 'Is it for the better?', 'Established', 'medium', 'open-ended'),
('What is one thing you wish I understood better about you?', 'How can I learn more?', 'Established', 'medium', 'open-ended'),
('If we could relive one day from our past, which one would it be?', 'Would you change anything?', 'Established', 'medium', 'open-ended'),
('What is the most romantic thing I have ever done for you?', 'Why did it mean so much?', 'Established', 'medium', 'open-ended'),
('How do you see our future together in 10 years?', 'What are you most excited about?', 'Established', 'medium', 'open-ended');

-- Mature (Deep Thoughts / Deep)
INSERT INTO questions (question_text, answer_text, context, difficulty, question_type) VALUES
('What does a "meaningful life" mean to you now compared to 20 years ago?', 'How have your priorities shifted?', 'Mature', 'deep', 'open-ended'),
('What is the most valuable lesson our relationship has taught you?', 'How has it changed you as a person?', 'Mature', 'deep', 'open-ended'),
('If you could give your younger self advice about love, what would it be?', 'Would you have listened?', 'Mature', 'deep', 'open-ended'),
('What legacy do you want us to leave behind?', 'How do we start building it now?', 'Mature', 'deep', 'open-ended'),
('What is one thing you have forgiven me for that was hard?', 'How did you find peace with it?', 'Mature', 'deep', 'open-ended'),
('How has your definition of "happiness" evolved over the years?', 'Are you happier now?', 'Mature', 'deep', 'open-ended'),
('What is one fear you have about aging?', 'How can we face it together?', 'Mature', 'deep', 'open-ended'),
('What is the most profound moment of connection we have ever shared?', 'What made it so deep?', 'Mature', 'deep', 'open-ended'),
('If you could apologize for one thing in our past, what would it be?', 'Why does it still linger?', 'Mature', 'deep', 'open-ended'),
('What is something you still want to discover about yourself?', 'How can I help you explore it?', 'Mature', 'deep', 'open-ended'),
('How do you want to be remembered by me?', 'What stories do you hope I tell?', 'Mature', 'deep', 'open-ended'),
('What has been the greatest test of our commitment?', 'How did we pass it?', 'Mature', 'deep', 'open-ended'),
('What does "unconditional love" look like in practice for us?', 'Do we achieve it?', 'Mature', 'deep', 'open-ended'),
('If this was our last conversation, what would you want me to know?', 'What is left unsaid?', 'Mature', 'deep', 'open-ended'),
('What is the spiritual or philosophical core of our union?', 'What binds us beyond the physical?', 'Mature', 'deep', 'open-ended');

-- Multiple Choice Questions
INSERT INTO questions (question_text, context, difficulty, question_type, options) VALUES
('Which superpower would you choose?', 'Exploring', 'easy', 'multiple-choice', '{
  "options": [
    {"id": "a", "text": "Flight"},
    {"id": "b", "text": "Invisibility"},
    {"id": "c", "text": "Time travel"},
    {"id": "d", "text": "Telepathy"}
  ]
}'),
('What is your ideal vacation style?', 'Exploring', 'easy', 'multiple-choice', '{
  "options": [
    {"id": "a", "text": "Relaxing on a beach"},
    {"id": "b", "text": "Hiking and adventure"},
    {"id": "c", "text": "Exploring a new city"},
    {"id": "d", "text": "Staycation at home"}
  ]
}'),
('Which love language matters most to you right now?', 'Established', 'medium', 'multiple-choice', '{
  "options": [
    {"id": "a", "text": "Words of Affirmation"},
    {"id": "b", "text": "Acts of Service"},
    {"id": "c", "text": "Receiving Gifts"},
    {"id": "d", "text": "Quality Time"},
    {"id": "e", "text": "Physical Touch"}
  ]
}'),
('If we won the lottery, what would be the first thing we do?', 'Established', 'medium', 'multiple-choice', '{
  "options": [
    {"id": "a", "text": "Pay off all debts"},
    {"id": "b", "text": "Buy a dream home"},
    {"id": "c", "text": "Travel the world"},
    {"id": "d", "text": "Donate to charity"}
  ]
}'),
('What is the most important quality in a long-term partner?', 'Mature', 'deep', 'multiple-choice', '{
  "options": [
    {"id": "a", "text": "Unwavering loyalty"},
    {"id": "b", "text": "Deep emotional intelligence"},
    {"id": "c", "text": "Shared sense of humor"},
    {"id": "d", "text": "Intellectual compatibility"}
  ]
}');

-- General / Mix
INSERT INTO questions (question_text, answer_text, context, difficulty, question_type) VALUES
('If you could solve one world problem, what would it be?', 'Why is this one most urgent?', 'Exploring', 'medium', 'open-ended'),
('What is a small act of kindness you will never forget?', 'Who showed it to you?', 'Exploring', 'medium', 'open-ended'),
('If you could write a book, what would it be about?', 'Fiction or non-fiction?', 'Exploring', 'medium', 'open-ended'),
('What is the most beautiful place you have ever seen?', 'Describe it.', 'Exploring', 'medium', 'open-ended'),
('What is a song that always makes you emotional?', 'What memory is it tied to?', 'Exploring', 'medium', 'open-ended');
