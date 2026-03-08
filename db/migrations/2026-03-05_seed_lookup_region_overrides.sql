/*
  Migration: Seed locale-region lookup translations for English variants
  Targets:
    - labels.postalCode
    - date.hint_short
*/
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID('dbo.DataCategory', 'U') IS NULL OR OBJECT_ID('dbo.Lookup', 'U') IS NULL OR OBJECT_ID('dbo.LookupTranslation', 'U') IS NULL
BEGIN
  RAISERROR('Lookup localization tables are missing. Run 2026-02-28_add_lookup_localization_system.sql first.', 16, 1);
  ROLLBACK TRANSACTION;
  RETURN;
END;

DECLARE @UiLabelCategoryId INT;
SELECT TOP 1 @UiLabelCategoryId = DataCategoryId
FROM dbo.DataCategory
WHERE DataName = N'UI_LABEL' AND IsActive = 1;

IF @UiLabelCategoryId IS NULL
BEGIN
  RAISERROR('UI_LABEL category not found in dbo.DataCategory.', 16, 1);
  ROLLBACK TRANSACTION;
  RETURN;
END;

IF OBJECT_ID('tempdb..#SeedKeys') IS NOT NULL DROP TABLE #SeedKeys;
CREATE TABLE #SeedKeys (
  SearchKey NVARCHAR(150) NOT NULL,
  Comments NVARCHAR(4000) NULL,
  SortOrder INT NOT NULL
);

INSERT INTO #SeedKeys (SearchKey, Comments, SortOrder)
VALUES
  (N'labels.postalCode', N'Region-specific postal label (ZIP vs Postal Code)', 0),
  (N'date.hint_short', N'Region-specific short date hint', 0);

/* Ensure at least one Lookup row exists per key in UI_LABEL */
INSERT INTO dbo.Lookup (DataCategoryId, SearchKey, Comments, SortOrder, IsActive, CreatedAtUtc)
SELECT
  @UiLabelCategoryId,
  k.SearchKey,
  k.Comments,
  k.SortOrder,
  1,
  SYSUTCDATETIME()
FROM #SeedKeys k
WHERE NOT EXISTS (
  SELECT 1
  FROM dbo.Lookup l
  WHERE l.DataCategoryId = @UiLabelCategoryId
    AND l.SearchKey = k.SearchKey
);

IF OBJECT_ID('tempdb..#LookupTargets') IS NOT NULL DROP TABLE #LookupTargets;
CREATE TABLE #LookupTargets (
  SearchKey NVARCHAR(150) NOT NULL,
  LookupId BIGINT NOT NULL
);

INSERT INTO #LookupTargets (SearchKey, LookupId)
SELECT
  k.SearchKey,
  lTop.LookupId
FROM #SeedKeys k
OUTER APPLY (
  SELECT TOP 1 l.LookupId
  FROM dbo.Lookup l
  WHERE l.DataCategoryId = @UiLabelCategoryId
    AND l.SearchKey = k.SearchKey
  ORDER BY l.SortOrder, l.LookupId
) lTop
WHERE lTop.LookupId IS NOT NULL;

IF OBJECT_ID('tempdb..#Translations') IS NOT NULL DROP TABLE #Translations;
CREATE TABLE #Translations (
  SearchKey NVARCHAR(150) NOT NULL,
  LocaleCode NVARCHAR(20) NOT NULL,
  TextValue NVARCHAR(4000) NOT NULL
);

INSERT INTO #Translations (SearchKey, LocaleCode, TextValue)
VALUES
  (N'labels.postalCode', N'en-US', N'ZIP Code'),
  (N'labels.postalCode', N'en-CA', N'Postal Code'),
  (N'labels.postalCode', N'en-GB', N'Postal Code'),
  (N'labels.postalCode', N'en-AU', N'Postal Code'),
  (N'date.hint_short', N'en-US', N'MM/DD/YYYY'),
  (N'date.hint_short', N'en-CA', N'YYYY-MM-DD'),
  (N'date.hint_short', N'en-GB', N'DD/MM/YYYY'),
  (N'date.hint_short', N'en-AU', N'DD/MM/YYYY');

MERGE dbo.LookupTranslation AS target
USING (
  SELECT
    lt.LookupId,
    t.LocaleCode,
    t.TextValue
  FROM #Translations t
  INNER JOIN #LookupTargets lt
    ON lt.SearchKey = t.SearchKey
) AS src
ON target.LookupId = src.LookupId
   AND target.LocaleCode = src.LocaleCode
WHEN MATCHED THEN
  UPDATE SET
    target.TextValue = src.TextValue,
    target.IsActive = 1,
    target.UpdatedAtUtc = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
  INSERT (LookupId, LocaleCode, TextValue, IsActive, CreatedAtUtc)
  VALUES (src.LookupId, src.LocaleCode, src.TextValue, 1, SYSUTCDATETIME());

COMMIT TRANSACTION;
