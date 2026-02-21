/*
  AI MCQ Generator - SQL Server Database Script
  Includes:
   - Schema (tables, constraints, indexes)
   - Seed/Dummy data for quick testing

  Notes:
   - PasswordHash values are placeholders. Use a real hashing approach in your app (e.g., ASP.NET Identity).
   - Correct answers are stored in Options.IsCorrect and should NOT be sent to students until after submit/result.
*/

------------------------------------------------------------
-- 0) Create DB (edit name if you want)
------------------------------------------------------------
IF DB_ID(N'AiMcqApp') IS NULL
BEGIN
  CREATE DATABASE AiMcqApp;
END
GO

USE AiMcqApp;
GO

------------------------------------------------------------
-- 1) Drop tables (for re-runs during dev)
------------------------------------------------------------
IF OBJECT_ID('dbo.Marks', 'U') IS NOT NULL DROP TABLE dbo.Marks;
IF OBJECT_ID('dbo.AttemptAnswers', 'U') IS NOT NULL DROP TABLE dbo.AttemptAnswers;
IF OBJECT_ID('dbo.Attempts', 'U') IS NOT NULL DROP TABLE dbo.Attempts;
IF OBJECT_ID('dbo.Options', 'U') IS NOT NULL DROP TABLE dbo.Options;
IF OBJECT_ID('dbo.Questions', 'U') IS NOT NULL DROP TABLE dbo.Questions;
IF OBJECT_ID('dbo.Quizzes', 'U') IS NOT NULL DROP TABLE dbo.Quizzes;
IF OBJECT_ID('dbo.ClassMembers', 'U') IS NOT NULL DROP TABLE dbo.ClassMembers;
IF OBJECT_ID('dbo.Classes', 'U') IS NOT NULL DROP TABLE dbo.Classes;
IF OBJECT_ID('dbo.Users', 'U') IS NOT NULL DROP TABLE dbo.Users;
GO

------------------------------------------------------------
-- 2) Core tables
------------------------------------------------------------

-- Users: Teachers + Students
CREATE TABLE dbo.Users (
    UserId            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
    Email             NVARCHAR(256)      NOT NULL,
    DisplayName       NVARCHAR(120)      NOT NULL,
    PasswordHash      NVARCHAR(400)      NOT NULL,
    Role              NVARCHAR(20)       NOT NULL,  -- 'Teacher' | 'Student' | 'Admin'
    IsActive          BIT                NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT (1),
    CreatedAtUtc      DATETIME2(0)       NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT (SYSUTCDATETIME())
);
GO

CREATE UNIQUE INDEX UX_Users_Email ON dbo.Users(Email);
GO

-- Classes created by Teacher
CREATE TABLE dbo.Classes (
    ClassId           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Classes PRIMARY KEY,
    OwnerUserId       INT               NOT NULL,
    ClassName         NVARCHAR(120)     NOT NULL,
    Subject           NVARCHAR(120)     NULL,
    GradeLevel        NVARCHAR(30)      NULL,
    JoinCode          NVARCHAR(12)      NOT NULL,
    CreatedAtUtc      DATETIME2(0)      NOT NULL CONSTRAINT DF_Classes_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_Classes_Owner FOREIGN KEY (OwnerUserId) REFERENCES dbo.Users(UserId)
);
GO

CREATE UNIQUE INDEX UX_Classes_JoinCode ON dbo.Classes(JoinCode);
CREATE INDEX IX_Classes_OwnerUserId ON dbo.Classes(OwnerUserId);
GO

-- Memberships: Students join class; Teacher can also be member
CREATE TABLE dbo.ClassMembers (
    ClassMemberId     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ClassMembers PRIMARY KEY,
    ClassId           INT               NOT NULL,
    UserId            INT               NOT NULL,
    RoleInClass       NVARCHAR(20)      NOT NULL, -- 'Teacher' | 'Student'
    JoinedAtUtc       DATETIME2(0)      NOT NULL CONSTRAINT DF_ClassMembers_JoinedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_ClassMembers_Class FOREIGN KEY (ClassId) REFERENCES dbo.Classes(ClassId) ON DELETE CASCADE,
    CONSTRAINT FK_ClassMembers_User  FOREIGN KEY (UserId)  REFERENCES dbo.Users(UserId)   ON DELETE CASCADE
);
GO

CREATE UNIQUE INDEX UX_ClassMembers_Class_User ON dbo.ClassMembers(ClassId, UserId);
CREATE INDEX IX_ClassMembers_UserId ON dbo.ClassMembers(UserId);
GO

-- Quizzes belong to a class
CREATE TABLE dbo.Quizzes (
    QuizId            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Quizzes PRIMARY KEY,
    ClassId           INT               NOT NULL,
    Title             NVARCHAR(200)     NOT NULL,
    Description       NVARCHAR(500)     NULL,
    Status            NVARCHAR(20)      NOT NULL, -- 'Draft' | 'Published'
    CreatedByUserId   INT               NOT NULL,
    CreatedAtUtc      DATETIME2(0)      NOT NULL CONSTRAINT DF_Quizzes_CreatedAt DEFAULT (SYSUTCDATETIME()),
    PublishedAtUtc    DATETIME2(0)      NULL,
    CONSTRAINT FK_Quizzes_Class FOREIGN KEY (ClassId)         REFERENCES dbo.Classes(ClassId) ON DELETE CASCADE,
    CONSTRAINT FK_Quizzes_User  FOREIGN KEY (CreatedByUserId) REFERENCES dbo.Users(UserId)
);
GO

CREATE INDEX IX_Quizzes_ClassId ON dbo.Quizzes(ClassId);
CREATE INDEX IX_Quizzes_CreatedByUserId ON dbo.Quizzes(CreatedByUserId);
GO

-- Questions
CREATE TABLE dbo.Questions (
    QuestionId        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Questions PRIMARY KEY,
    QuizId            INT               NOT NULL,
    QuestionText      NVARCHAR(2000)    NOT NULL,
    Explanation       NVARCHAR(2000)    NULL,
    Difficulty        NVARCHAR(20)      NULL, -- 'Easy'|'Medium'|'Hard'
    TopicTag          NVARCHAR(100)     NULL,
    SortOrder         INT               NOT NULL CONSTRAINT DF_Questions_SortOrder DEFAULT (0),
    CreatedAtUtc      DATETIME2(0)      NOT NULL CONSTRAINT DF_Questions_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_Questions_Quiz FOREIGN KEY (QuizId) REFERENCES dbo.Quizzes(QuizId) ON DELETE CASCADE
);
GO

CREATE INDEX IX_Questions_QuizId ON dbo.Questions(QuizId);
GO

-- Options (4 options typical; supports more)
CREATE TABLE dbo.Options (
    OptionId          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Options PRIMARY KEY,
    QuestionId        INT               NOT NULL,
    OptionLabel       NVARCHAR(5)       NULL,   -- 'A' 'B' 'C' 'D' etc
    OptionText        NVARCHAR(1000)    NOT NULL,
    IsCorrect         BIT               NOT NULL CONSTRAINT DF_Options_IsCorrect DEFAULT (0),
    SortOrder         INT               NOT NULL CONSTRAINT DF_Options_SortOrder DEFAULT (0),
    CONSTRAINT FK_Options_Question FOREIGN KEY (QuestionId) REFERENCES dbo.Questions(QuestionId) ON DELETE CASCADE
);
GO

CREATE INDEX IX_Options_QuestionId ON dbo.Options(QuestionId);
GO

------------------------------------------------------------
-- 3) Transactions: Attempts + Answers (recording)
------------------------------------------------------------

-- Each time a student takes a quiz = an Attempt
CREATE TABLE dbo.Attempts (
    AttemptId         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Attempts PRIMARY KEY,
    QuizId            INT               NOT NULL,
    UserId            INT               NOT NULL,  -- student
    StartedAtUtc      DATETIME2(0)      NOT NULL CONSTRAINT DF_Attempts_StartedAt DEFAULT (SYSUTCDATETIME()),
    SubmittedAtUtc    DATETIME2(0)      NULL,
    Status            NVARCHAR(20)      NOT NULL CONSTRAINT DF_Attempts_Status DEFAULT ('InProgress'), -- 'InProgress'|'Submitted'
    CONSTRAINT FK_Attempts_Quiz FOREIGN KEY (QuizId) REFERENCES dbo.Quizzes(QuizId) ON DELETE CASCADE,
    CONSTRAINT FK_Attempts_User FOREIGN KEY (UserId) REFERENCES dbo.Users(UserId)  ON DELETE CASCADE
);
GO

CREATE INDEX IX_Attempts_Quiz_User ON dbo.Attempts(QuizId, UserId);
GO

-- Transaction table where answers are recorded (one row per question answered)
CREATE TABLE dbo.AttemptAnswers (
    AttemptAnswerId   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AttemptAnswers PRIMARY KEY,
    AttemptId         INT               NOT NULL,
    QuestionId        INT               NOT NULL,
    SelectedOptionId  INT               NULL,  -- NULL means unanswered
    AnsweredAtUtc     DATETIME2(0)      NOT NULL CONSTRAINT DF_AttemptAnswers_AnsweredAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_AttemptAnswers_Attempt  FOREIGN KEY (AttemptId)        REFERENCES dbo.Attempts(AttemptId) ON DELETE CASCADE,
    CONSTRAINT FK_AttemptAnswers_Question  FOREIGN KEY (QuestionId)       REFERENCES dbo.Questions(QuestionId),
    CONSTRAINT FK_AttemptAnswers_Option    FOREIGN KEY (SelectedOptionId) REFERENCES dbo.Options(OptionId)
);
GO

CREATE UNIQUE INDEX UX_AttemptAnswers_Attempt_Question ON dbo.AttemptAnswers(AttemptId, QuestionId);
CREATE INDEX IX_AttemptAnswers_SelectedOptionId ON dbo.AttemptAnswers(SelectedOptionId);
GO

-- Final marks table (can also be derived, but storing is convenient for reporting)
CREATE TABLE dbo.Marks (
    MarkId            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Marks PRIMARY KEY,
    AttemptId         INT               NOT NULL,
    TotalQuestions    INT               NOT NULL,
    CorrectCount      INT               NOT NULL,
    ScorePercent      DECIMAL(5,2)      NOT NULL,
    CalculatedAtUtc   DATETIME2(0)      NOT NULL CONSTRAINT DF_Marks_CalculatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_Marks_Attempt FOREIGN KEY (AttemptId) REFERENCES dbo.Attempts(AttemptId) ON DELETE CASCADE
);
GO

CREATE UNIQUE INDEX UX_Marks_AttemptId ON dbo.Marks(AttemptId);
GO

------------------------------------------------------------
-- 4) Seed / Dummy Data
------------------------------------------------------------

-- Users (5)
INSERT INTO dbo.Users (Email, DisplayName, PasswordHash, Role)
VALUES
('teacher1@example.com', 'Mr. Johnson', 'HASH_PLACEHOLDER_1', 'Teacher'),
('teacher2@example.com', 'Ms. Patel',   'HASH_PLACEHOLDER_2', 'Teacher'),
('student1@example.com', 'Sara Ali',    'HASH_PLACEHOLDER_3', 'Student'),
('student2@example.com', 'Zain Ali',    'HASH_PLACEHOLDER_4', 'Student'),
('student3@example.com', 'Amat Ali',    'HASH_PLACEHOLDER_5', 'Student');

-- Classes (5)
INSERT INTO dbo.Classes (OwnerUserId, ClassName, Subject, GradeLevel, JoinCode)
VALUES
(1, 'Grade 9 Math',     'Mathematics', '9',  'G9MATH01'),
(1, 'Grade 10 Science', 'Science',     '10', 'G10SCI01'),
(2, 'English Writing',  'English',     '9',  'ENGW0901'),
(2, 'History Basics',   'History',     '10', 'HIS1001'),
(1, 'Computer Science', 'CS',          '11', 'CS1101');

-- ClassMembers (5) - include a teacher and students
INSERT INTO dbo.ClassMembers (ClassId, UserId, RoleInClass)
VALUES
(1, 1, 'Teacher'),
(1, 3, 'Student'),
(1, 4, 'Student'),
(2, 1, 'Teacher'),
(2, 5, 'Student');

-- Quizzes (5)
INSERT INTO dbo.Quizzes (ClassId, Title, Description, Status, CreatedByUserId, PublishedAtUtc)
VALUES
(1, 'Algebra Quiz',   'Linear equations basics', 'Published', 1, SYSUTCDATETIME()),
(1, 'Geometry Quiz',  'Angles and triangles',    'Draft',     1, NULL),
(2, 'Physics MCQs',   'Motion and forces',       'Published', 1, SYSUTCDATETIME()),
(3, 'Grammar Quiz',   'Parts of speech',         'Draft',     2, NULL),
(5, 'SQL Basics',     'Intro SQL MCQs',          'Published', 1, SYSUTCDATETIME());

-- Questions (5) -> attach to QuizId 1 for simple demo
INSERT INTO dbo.Questions (QuizId, QuestionText, Explanation, Difficulty, TopicTag, SortOrder)
VALUES
(1, 'What is the value of 3x + 5 if x = 4?', '3(4) + 5 = 12 + 5 = 17', 'Easy',   'Algebra', 1),
(1, 'Solve: 2x = 10. What is x?',            'Divide both sides by 2: x = 5',     'Easy',   'Algebra', 2),
(1, 'What is 7 * 6?',                         '7 times 6 equals 42',              'Easy',   'Arithmetic', 3),
(1, 'If y = x - 2 and x = 9, what is y?',    '9 - 2 = 7',                         'Easy',   'Algebra', 4),
(1, 'What is the next prime after 7?',       'Prime numbers: 2,3,5,7,11...',      'Medium', 'Numbers', 5);

-- Options (20) = 4 per question
-- Q1
INSERT INTO dbo.Options (QuestionId, OptionLabel, OptionText, IsCorrect, SortOrder) VALUES
(1,'A','14',0,1),(1,'B','17',1,2),(1,'C','19',0,3),(1,'D','21',0,4);
-- Q2
INSERT INTO dbo.Options (QuestionId, OptionLabel, OptionText, IsCorrect, SortOrder) VALUES
(2,'A','2',0,1),(2,'B','4',0,2),(2,'C','5',1,3),(2,'D','10',0,4);
-- Q3
INSERT INTO dbo.Options (QuestionId, OptionLabel, OptionText, IsCorrect, SortOrder) VALUES
(3,'A','36',0,1),(3,'B','40',0,2),(3,'C','42',1,3),(3,'D','48',0,4);
-- Q4
INSERT INTO dbo.Options (QuestionId, OptionLabel, OptionText, IsCorrect, SortOrder) VALUES
(4,'A','5',0,1),(4,'B','6',0,2),(4,'C','7',1,3),(4,'D','8',0,4);
-- Q5
INSERT INTO dbo.Options (QuestionId, OptionLabel, OptionText, IsCorrect, SortOrder) VALUES
(5,'A','9',0,1),(5,'B','10',0,2),(5,'C','11',1,3),(5,'D','12',0,4);

-- Attempts (5) - students taking Algebra Quiz (QuizId=1)
INSERT INTO dbo.Attempts (QuizId, UserId, StartedAtUtc, SubmittedAtUtc, Status)
VALUES
(1, 3, DATEADD(MINUTE,-30,SYSUTCDATETIME()), SYSUTCDATETIME(), 'Submitted'),
(1, 4, DATEADD(MINUTE,-25,SYSUTCDATETIME()), SYSUTCDATETIME(), 'Submitted'),
(1, 5, DATEADD(MINUTE,-20,SYSUTCDATETIME()), SYSUTCDATETIME(), 'Submitted'),
(3, 3, DATEADD(MINUTE,-15,SYSUTCDATETIME()), SYSUTCDATETIME(), 'Submitted'),
(5, 4, DATEADD(MINUTE,-10,SYSUTCDATETIME()), SYSUTCDATETIME(), 'Submitted');

-- AttemptAnswers (5) - sample recorded answers for AttemptId=1 (student1)
-- Q1 correct option is OptionId=2 (from seed above), etc.
INSERT INTO dbo.AttemptAnswers (AttemptId, QuestionId, SelectedOptionId)
VALUES
(1, 1, 2),   -- correct
(1, 2, 7),   -- correct (Q2 option 'C' is OptionId 7)
(1, 3, 11),  -- correct (Q3 option 'C' is OptionId 11)
(1, 4, 15),  -- correct (Q4 option 'C' is OptionId 15)
(1, 5, 18);  -- wrong (Q5 correct is OptionId 19)

-- Marks (5) - demo marks for attempts
INSERT INTO dbo.Marks (AttemptId, TotalQuestions, CorrectCount, ScorePercent)
VALUES
(1, 5, 4, 80.00),
(2, 5, 3, 60.00),
(3, 5, 5, 100.00),
(4, 10, 7, 70.00),
(5, 10, 8, 80.00);

------------------------------------------------------------
-- 5) Quick verification queries
------------------------------------------------------------
-- View classes and quizzes
-- SELECT c.ClassName, q.Title, q.Status FROM dbo.Classes c JOIN dbo.Quizzes q ON q.ClassId = c.ClassId;

-- View quiz questions and options (QuizId = 1)
-- SELECT qu.Title, qs.QuestionId, qs.QuestionText, op.OptionLabel, op.OptionText, op.IsCorrect
-- FROM dbo.Quizzes qu
-- JOIN dbo.Questions qs ON qs.QuizId = qu.QuizId
-- JOIN dbo.Options op ON op.QuestionId = qs.QuestionId
-- WHERE qu.QuizId = 1
-- ORDER BY qs.SortOrder, op.SortOrder;

-- View attempt result detail (AttemptId = 1)
-- SELECT a.AttemptId, u.DisplayName, qs.QuestionText,
--        sel.OptionLabel AS SelectedLabel, sel.OptionText AS SelectedText,
--        cor.OptionLabel AS CorrectLabel,  cor.OptionText AS CorrectText
-- FROM dbo.Attempts a
-- JOIN dbo.Users u ON u.UserId = a.UserId
-- JOIN dbo.AttemptAnswers aa ON aa.AttemptId = a.AttemptId
-- JOIN dbo.Questions qs ON qs.QuestionId = aa.QuestionId
-- LEFT JOIN dbo.Options sel ON sel.OptionId = aa.SelectedOptionId
-- LEFT JOIN dbo.Options cor ON cor.QuestionId = qs.QuestionId AND cor.IsCorrect = 1
-- WHERE a.AttemptId = 1
-- ORDER BY qs.SortOrder;
