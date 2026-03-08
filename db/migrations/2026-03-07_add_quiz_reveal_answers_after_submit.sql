IF COL_LENGTH('dbo.Quiz', 'RevealAnswersAfterSubmit') IS NULL
BEGIN
  ALTER TABLE dbo.Quiz
    ADD RevealAnswersAfterSubmit bit NOT NULL
      CONSTRAINT DF_Quiz_RevealAnswersAfterSubmit DEFAULT (0);
END;
