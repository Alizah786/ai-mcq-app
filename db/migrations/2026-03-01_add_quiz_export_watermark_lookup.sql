SET NOCOUNT ON;

DECLARE @UiLabelCategoryId BIGINT;

SELECT TOP 1
  @UiLabelCategoryId = DataCategoryId
FROM dbo.DataCategory
WHERE DataName = N'UI_LABEL';

IF @UiLabelCategoryId IS NOT NULL
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dbo.Lookup
    WHERE DataCategoryId = @UiLabelCategoryId
      AND SearchKey = N'quiz.exportWatermark.student'
  )
  BEGIN
    INSERT INTO dbo.Lookup
      (DataCategoryId, SearchKey, Comments, SortOrder, IsActive, CreatedAtUtc)
    VALUES
      (@UiLabelCategoryId, N'quiz.exportWatermark.student', N'Student free-plan PDF watermark text', 0, 1, SYSUTCDATETIME());
  END;

  MERGE dbo.LookupTranslation AS target
  USING (
    SELECT
      l.LookupId,
      N'en-US' AS LocaleCode,
      N'Student Free Trial Export' AS TextValue
    FROM dbo.Lookup l
    WHERE l.DataCategoryId = @UiLabelCategoryId
      AND l.SearchKey = N'quiz.exportWatermark.student'
  ) AS source
    ON target.LookupId = source.LookupId
   AND target.LocaleCode = source.LocaleCode
   AND target.IsActive = 1
  WHEN MATCHED THEN
    UPDATE SET
      TextValue = source.TextValue,
      UpdatedAtUtc = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN
    INSERT
      (LookupId, LocaleCode, TextValue, IsActive, EffectiveFromUtc, EffectiveToUtc, CreatedAtUtc, UpdatedAtUtc)
    VALUES
      (source.LookupId, source.LocaleCode, source.TextValue, 1, NULL, NULL, SYSUTCDATETIME(), SYSUTCDATETIME());
END;
