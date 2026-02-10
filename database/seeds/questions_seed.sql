-- Clear existing questions (optional, or just append)
TRUNCATE TABLE questions RESTART IDENTITY CASCADE;

-- EXPLORING CONTEXT (25 Questions)
-- Easy (10)
INSERT INTO questions (question_text, answer_text, question_type, context, difficulty) VALUES 
('What is the best meal you have ever had?', 'Think about the setting, the company, and the food itself.', 'open-ended', 'Exploring', 'easy'),
('What is your favorite way to spend a Sunday morning?', NULL, 'open-ended', 'Exploring', 'easy'),
('If you could travel anywhere right now, where would you go?', 'Consider why this place calls to you at this moment.', 'open-ended', 'Exploring', 'easy'),
('What was your favorite cartoon or show growing up?', NULL, 'open-ended', 'Exploring', 'easy'),
('What is a skill you have always wanted to learn?', 'Think about what has stopped you so far.', 'open-ended', 'Exploring', 'easy'),
('Which superpower would you choose?', NULL, 'multiple-choice', 'Exploring', 'easy'),
('What is your go-to comfort food?', NULL, 'open-ended', 'Exploring', 'easy'),
('If you could have dinner with any historical figure, who would it be?', 'What is the one question you would ask them?', 'open-ended', 'Exploring', 'easy'),
('What is the most spontaneous thing you have ever done?', NULL, 'open-ended', 'Exploring', 'easy'),
('What is your favorite season and why?', NULL, 'multiple-choice', 'Exploring', 'easy');

-- Medium (10)
INSERT INTO questions (question_text, answer_text, question_type, context, difficulty) VALUES 
('What is a small act of kindness that you still remember?', 'It could be from a stranger or someone close to you.', 'open-ended', 'Exploring', 'medium'),
('What is something you are currently passionate about?', NULL, 'open-ended', 'Exploring', 'medium'),
('If you could change one thing about your past, would you?', 'Think about how it might change who you are today.', 'open-ended', 'Exploring', 'medium'),
('What does your perfect day look like?', NULL, 'open-ended', 'Exploring', 'medium'),
('What is a book or movie that changed your perspective?', NULL, 'open-ended', 'Exploring', 'medium'),
('Which element do you relate to most?', NULL, 'multiple-choice', 'Exploring', 'medium'),
('What is the best advice you have ever received?', NULL, 'open-ended', 'Exploring', 'medium'),
('What is a fear you have overcome?', NULL, 'open-ended', 'Exploring', 'medium'),
('What makes you feel most alive?', NULL, 'open-ended', 'Exploring', 'medium'),
('If you could instantly become an expert in one subject, what would it be?', NULL, 'open-ended', 'Exploring', 'medium');

-- Deep (5)
INSERT INTO questions (question_text, answer_text, question_type, context, difficulty) VALUES 
('What is a dream you have let go of?', 'Is there a part of you that still holds onto it?', 'open-ended', 'Exploring', 'deep'),
('What do you value most in a friendship?', NULL, 'open-ended', 'Exploring', 'deep'),
('When was the last time you cried, and why?', 'Vulnerability is a strength.', 'open-ended', 'Exploring', 'deep'),
('What is something you want to be remembered for?', NULL, 'open-ended', 'Exploring', 'deep'),
('If you knew you only had one year left to live, what would you change?', NULL, 'open-ended', 'Exploring', 'deep');

-- ESTABLISHED CONTEXT (20 Questions)
-- Easy (5)
INSERT INTO questions (question_text, answer_text, question_type, context, difficulty) VALUES 
('What is your favorite memory of us?', 'Think back to the early days.', 'open-ended', 'Established', 'easy'),
('What is a song that reminds you of me?', NULL, 'open-ended', 'Established', 'easy'),
('What is the funniest thing we have experienced together?', NULL, 'open-ended', 'Established', 'easy'),
('What is your favorite meal that we cook together?', NULL, 'open-ended', 'Established', 'easy'),
('Which vacation destination should we plan next?', NULL, 'multiple-choice', 'Established', 'easy');

-- Medium (10)
INSERT INTO questions (question_text, answer_text, question_type, context, difficulty) VALUES 
('What is something I do that makes you feel loved?', 'Be specific about the action and the feeling.', 'open-ended', 'Established', 'medium'),
('How have we changed since we first met?', NULL, 'open-ended', 'Established', 'medium'),
('What is a challenge we faced that made us stronger?', NULL, 'open-ended', 'Established', 'medium'),
('What is one thing you appreciate about our communication?', NULL, 'open-ended', 'Established', 'medium'),
('How do you think we handle conflict?', 'Is there a pattern you have noticed?', 'open-ended', 'Established', 'medium'),
('What is a shared goal we should focus on this year?', NULL, 'multiple-choice', 'Established', 'medium'),
('What is something you wish we did more of together?', NULL, 'open-ended', 'Established', 'medium'),
('How do I support your individual growth?', NULL, 'open-ended', 'Established', 'medium'),
('What is a tradition you want to start with me?', NULL, 'open-ended', 'Established', 'medium'),
('What is the most romantic thing I have done for you recently?', NULL, 'open-ended', 'Established', 'medium');

-- Deep (5)
INSERT INTO questions (question_text, answer_text, question_type, context, difficulty) VALUES 
('What are you most afraid of losing in our relationship?', 'Honesty brings us closer.', 'open-ended', 'Established', 'deep'),
('How can I be a better partner to you?', NULL, 'open-ended', 'Established', 'deep'),
('What does "commitment" mean to you now vs. when we started?', NULL, 'open-ended', 'Established', 'deep'),
('Is there something unsaid that you want to share with me?', NULL, 'open-ended', 'Established', 'deep'),
('What is your vision for our future in 10 years?', NULL, 'open-ended', 'Established', 'deep');

-- MATURE CONTEXT (15 Questions)
-- Medium (5)
INSERT INTO questions (question_text, answer_text, question_type, context, difficulty) VALUES 
('What is the secret to our longevity?', 'Think about the habits that have sustained us.', 'open-ended', 'Mature', 'medium'),
('What is a memory from our 20s/30s that makes you smile?', NULL, 'open-ended', 'Mature', 'medium'),
('How has your definition of love evolved?', NULL, 'open-ended', 'Mature', 'medium'),
('What is something you still want to experience with me?', NULL, 'open-ended', 'Mature', 'medium'),
('Which phase of our life together has been your favorite?', NULL, 'multiple-choice', 'Mature', 'medium');

-- Deep (10)
INSERT INTO questions (question_text, answer_text, question_type, context, difficulty) VALUES 
('What legacy do we want to leave behind?', 'Think beyond material things.', 'open-ended', 'Mature', 'deep'),
('How have I helped you become the person you are today?', NULL, 'open-ended', 'Mature', 'deep'),
('What is a hardship we endured that defined us?', NULL, 'open-ended', 'Mature', 'deep'),
('What do you want our remaining years to look like?', NULL, 'open-ended', 'Mature', 'deep'),
('If you could relive one day of our marriage, which would it be?', NULL, 'open-ended', 'Mature', 'deep'),
('What have you learned about forgiveness through me?', NULL, 'open-ended', 'Mature', 'deep'),
('What is the most important lesson we have taught our children (or others)?', NULL, 'open-ended', 'Mature', 'deep'),
('How do you want to be remembered by me?', NULL, 'open-ended', 'Mature', 'deep'),
('What is the greatest gift our relationship has given you?', NULL, 'open-ended', 'Mature', 'deep'),
('Are there any regrets you want to release today?', 'Letting go can be healing.', 'open-ended', 'Mature', 'deep');

-- Update Multiple Choice Options
UPDATE questions 
SET options = '{ "options": [ {"id": "flight", "text": "Flight"}, {"id": "invisibility", "text": "Invisibility"}, {"id": "time_travel", "text": "Time Travel"}, {"id": "telepathy", "text": "Telepathy"} ] }'::jsonb 
WHERE question_text = 'Which superpower would you choose?';

UPDATE questions 
SET options = '{ "options": [ {"id": "spring", "text": "Spring"}, {"id": "summer", "text": "Summer"}, {"id": "autumn", "text": "Autumn"}, {"id": "winter", "text": "Winter"} ] }'::jsonb 
WHERE question_text = 'What is your favorite season and why?';

UPDATE questions 
SET options = '{ "options": [ {"id": "fire", "text": "Fire (Passion/Energy)"}, {"id": "water", "text": "Water (Emotion/Flow)"}, {"id": "earth", "text": "Earth (Stability/Growth)"}, {"id": "air", "text": "Air (Intellect/Freedom)"} ] }'::jsonb 
WHERE question_text = 'Which element do you relate to most?';

UPDATE questions 
SET options = '{ "options": [ {"id": "beach", "text": "Relaxing Beach Resort"}, {"id": "adventure", "text": "Mountain Adventure"}, {"id": "city", "text": "European City Tour"}, {"id": "staycation", "text": "Cozy Staycation"} ] }'::jsonb 
WHERE question_text = 'Which vacation destination should we plan next?';

UPDATE questions 
SET options = '{ "options": [ {"id": "finance", "text": "Financial Freedom"}, {"id": "health", "text": "Health & Fitness"}, {"id": "hobby", "text": "Learning a New Hobby"}, {"id": "travel", "text": "Traveling More"} ] }'::jsonb 
WHERE question_text = 'What is a shared goal we should focus on this year?';

UPDATE questions 
SET options = '{ "options": [ {"id": "newlyweds", "text": "The Beginning"}, {"id": "middle", "text": "The Middle Years"}, {"id": "now", "text": "Right Now"}, {"id": "future", "text": "The Future"} ] }'::jsonb 
WHERE question_text = 'Which phase of our life together has been your favorite?';
