SET NOCOUNT ON;

IF OBJECT_ID('dbo.DataCategory', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.DataCategory
  (
    DataCategoryId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    DataName NVARCHAR(100) NOT NULL,
    Description NVARCHAR(300) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_DataCategory_IsActive DEFAULT(1),
    CreatedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_DataCategory_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
    UpdatedAtUtc DATETIME2 NULL
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_DataCategory_DataName'
    AND object_id = OBJECT_ID('dbo.DataCategory')
)
BEGIN
  CREATE UNIQUE INDEX UX_DataCategory_DataName
    ON dbo.DataCategory(DataName);
END;

IF OBJECT_ID('dbo.Lookup', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Lookup
  (
    LookupId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    DataCategoryId INT NOT NULL,
    SearchKey NVARCHAR(150) NOT NULL,
    Comments NVARCHAR(4000) NULL,
    SortOrder INT NOT NULL CONSTRAINT DF_Lookup_SortOrder DEFAULT(0),
    IsActive BIT NOT NULL CONSTRAINT DF_Lookup_IsActive DEFAULT(1),
    EffectiveFromUtc DATETIME2 NULL,
    EffectiveToUtc DATETIME2 NULL,
    CreatedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_Lookup_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
    UpdatedAtUtc DATETIME2 NULL,
    CreatedByUserNameRegistryId BIGINT NULL,
    CONSTRAINT FK_Lookup_DataCategory FOREIGN KEY (DataCategoryId) REFERENCES dbo.DataCategory(DataCategoryId)
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_Lookup_Category_Key_Sort'
    AND object_id = OBJECT_ID('dbo.Lookup')
)
BEGIN
  CREATE INDEX IX_Lookup_Category_Key_Sort
    ON dbo.Lookup(DataCategoryId, SearchKey, SortOrder, LookupId);
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_Lookup_Active_Window'
    AND object_id = OBJECT_ID('dbo.Lookup')
)
BEGIN
  CREATE INDEX IX_Lookup_Active_Window
    ON dbo.Lookup(IsActive, EffectiveFromUtc, EffectiveToUtc);
END;

IF OBJECT_ID('dbo.LookupTranslation', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.LookupTranslation
  (
    LookupTranslationId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    LookupId BIGINT NOT NULL,
    LocaleCode NVARCHAR(20) NOT NULL,
    TextValue NVARCHAR(4000) NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_LookupTranslation_IsActive DEFAULT(1),
    EffectiveFromUtc DATETIME2 NULL,
    EffectiveToUtc DATETIME2 NULL,
    CreatedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_LookupTranslation_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
    UpdatedAtUtc DATETIME2 NULL,
    CreatedByUserNameRegistryId BIGINT NULL,
    CONSTRAINT FK_LookupTranslation_Lookup FOREIGN KEY (LookupId) REFERENCES dbo.Lookup(LookupId)
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_LookupTranslation_Lookup_Locale'
    AND object_id = OBJECT_ID('dbo.LookupTranslation')
)
BEGIN
  CREATE UNIQUE INDEX UX_LookupTranslation_Lookup_Locale
    ON dbo.LookupTranslation(LookupId, LocaleCode);
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_LookupTranslation_Locale_Active'
    AND object_id = OBJECT_ID('dbo.LookupTranslation')
)
BEGIN
  CREATE INDEX IX_LookupTranslation_Locale_Active
    ON dbo.LookupTranslation(LocaleCode, IsActive, EffectiveFromUtc, EffectiveToUtc);
END;

IF TYPE_ID(N'dbo.StringList') IS NULL
BEGIN
  EXEC('CREATE TYPE dbo.StringList AS TABLE (Value NVARCHAR(150) NOT NULL);');
END;

MERGE dbo.DataCategory AS target
USING (
  VALUES
    (N'UI_LABEL', N'UI labels and button text'),
    (N'UI_PLACEHOLDER', N'Input placeholders'),
    (N'UI_TOOLTIP', N'Tooltips'),
    (N'UI_HELP_TEXT', N'Inline helper text'),
    (N'UI_MESSAGE', N'UI informational and status messages'),
    (N'VALIDATION_MESSAGE', N'Validation text'),
    (N'DROPDOWN_OPTIONS', N'Dropdown option values'),
    (N'FEATURE_TEXT', N'Small feature and config text')
) AS src (DataName, Description)
ON target.DataName = src.DataName
WHEN MATCHED THEN
  UPDATE SET
    target.Description = src.Description,
    target.IsActive = 1,
    target.UpdatedAtUtc = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
  INSERT (DataName, Description, IsActive, CreatedAtUtc)
  VALUES (src.DataName, src.Description, 1, SYSUTCDATETIME());

GO
CREATE OR ALTER PROCEDURE dbo.usp_Lookup_GetByCategoryAndKey
  @CategoryName NVARCHAR(100),
  @SearchKey NVARCHAR(150),
  @LocaleCode NVARCHAR(20),
  @FallbackLocaleCode NVARCHAR(20) = N'en-US'
AS
BEGIN
  SET NOCOUNT ON;

  ;WITH base AS (
    SELECT
      l.LookupId,
      l.DataCategoryId,
      dc.DataName,
      l.SearchKey,
      l.Comments,
      l.SortOrder
    FROM dbo.Lookup l
    INNER JOIN dbo.DataCategory dc
      ON dc.DataCategoryId = l.DataCategoryId
    WHERE dc.DataName = @CategoryName
      AND l.SearchKey = @SearchKey
      AND dc.IsActive = 1
      AND l.IsActive = 1
      AND (l.EffectiveFromUtc IS NULL OR l.EffectiveFromUtc <= SYSUTCDATETIME())
      AND (l.EffectiveToUtc IS NULL OR l.EffectiveToUtc > SYSUTCDATETIME())
  ),
  resolved AS (
    SELECT
      b.LookupId,
      b.DataCategoryId,
      b.DataName,
      b.SearchKey,
      COALESCE(tExact.TextValue, tFallback.TextValue) AS TextValue,
      b.Comments,
      b.SortOrder
    FROM base b
    OUTER APPLY (
      SELECT TOP 1 TextValue
      FROM dbo.LookupTranslation lt
      WHERE lt.LookupId = b.LookupId
        AND lt.LocaleCode = @LocaleCode
        AND lt.IsActive = 1
        AND (lt.EffectiveFromUtc IS NULL OR lt.EffectiveFromUtc <= SYSUTCDATETIME())
        AND (lt.EffectiveToUtc IS NULL OR lt.EffectiveToUtc > SYSUTCDATETIME())
      ORDER BY lt.LookupTranslationId
    ) tExact
    OUTER APPLY (
      SELECT TOP 1 TextValue
      FROM dbo.LookupTranslation lt
      WHERE lt.LookupId = b.LookupId
        AND lt.LocaleCode = @FallbackLocaleCode
        AND lt.IsActive = 1
        AND (lt.EffectiveFromUtc IS NULL OR lt.EffectiveFromUtc <= SYSUTCDATETIME())
        AND (lt.EffectiveToUtc IS NULL OR lt.EffectiveToUtc > SYSUTCDATETIME())
      ORDER BY lt.LookupTranslationId
    ) tFallback
  )
  SELECT
    LookupId,
    DataCategoryId,
    DataName,
    SearchKey,
    TextValue,
    Comments,
    SortOrder
  FROM resolved
  WHERE TextValue IS NOT NULL
  ORDER BY SortOrder, LookupId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_Lookup_GetSingleValue
  @CategoryName NVARCHAR(100),
  @SearchKey NVARCHAR(150),
  @LocaleCode NVARCHAR(20),
  @FallbackLocaleCode NVARCHAR(20) = N'en-US'
AS
BEGIN
  SET NOCOUNT ON;

  ;WITH base AS (
    SELECT
      l.LookupId,
      l.SortOrder
    FROM dbo.Lookup l
    INNER JOIN dbo.DataCategory dc
      ON dc.DataCategoryId = l.DataCategoryId
    WHERE dc.DataName = @CategoryName
      AND l.SearchKey = @SearchKey
      AND dc.IsActive = 1
      AND l.IsActive = 1
      AND (l.EffectiveFromUtc IS NULL OR l.EffectiveFromUtc <= SYSUTCDATETIME())
      AND (l.EffectiveToUtc IS NULL OR l.EffectiveToUtc > SYSUTCDATETIME())
  )
  SELECT TOP 1
    Value = COALESCE(tExact.TextValue, tFallback.TextValue)
  FROM base b
  OUTER APPLY (
    SELECT TOP 1 TextValue
    FROM dbo.LookupTranslation lt
    WHERE lt.LookupId = b.LookupId
      AND lt.LocaleCode = @LocaleCode
      AND lt.IsActive = 1
      AND (lt.EffectiveFromUtc IS NULL OR lt.EffectiveFromUtc <= SYSUTCDATETIME())
      AND (lt.EffectiveToUtc IS NULL OR lt.EffectiveToUtc > SYSUTCDATETIME())
    ORDER BY lt.LookupTranslationId
  ) tExact
  OUTER APPLY (
    SELECT TOP 1 TextValue
    FROM dbo.LookupTranslation lt
    WHERE lt.LookupId = b.LookupId
      AND lt.LocaleCode = @FallbackLocaleCode
      AND lt.IsActive = 1
      AND (lt.EffectiveFromUtc IS NULL OR lt.EffectiveFromUtc <= SYSUTCDATETIME())
      AND (lt.EffectiveToUtc IS NULL OR lt.EffectiveToUtc > SYSUTCDATETIME())
    ORDER BY lt.LookupTranslationId
  ) tFallback
  WHERE COALESCE(tExact.TextValue, tFallback.TextValue) IS NOT NULL
  ORDER BY b.SortOrder, b.LookupId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_Lookup_GetBySearchKey
  @SearchKey NVARCHAR(150),
  @LocaleCode NVARCHAR(20),
  @FallbackLocaleCode NVARCHAR(20) = N'en-US'
AS
BEGIN
  SET NOCOUNT ON;

  ;WITH base AS (
    SELECT
      l.LookupId,
      l.DataCategoryId,
      dc.DataName,
      l.SearchKey,
      l.Comments,
      l.SortOrder
    FROM dbo.Lookup l
    INNER JOIN dbo.DataCategory dc
      ON dc.DataCategoryId = l.DataCategoryId
    WHERE l.SearchKey = @SearchKey
      AND dc.IsActive = 1
      AND l.IsActive = 1
      AND (l.EffectiveFromUtc IS NULL OR l.EffectiveFromUtc <= SYSUTCDATETIME())
      AND (l.EffectiveToUtc IS NULL OR l.EffectiveToUtc > SYSUTCDATETIME())
  )
  SELECT
    b.LookupId,
    b.DataCategoryId,
    b.DataName,
    b.SearchKey,
    COALESCE(tExact.TextValue, tFallback.TextValue) AS TextValue,
    b.Comments,
    b.SortOrder
  FROM base b
  OUTER APPLY (
    SELECT TOP 1 TextValue
    FROM dbo.LookupTranslation lt
    WHERE lt.LookupId = b.LookupId
      AND lt.LocaleCode = @LocaleCode
      AND lt.IsActive = 1
      AND (lt.EffectiveFromUtc IS NULL OR lt.EffectiveFromUtc <= SYSUTCDATETIME())
      AND (lt.EffectiveToUtc IS NULL OR lt.EffectiveToUtc > SYSUTCDATETIME())
    ORDER BY lt.LookupTranslationId
  ) tExact
  OUTER APPLY (
    SELECT TOP 1 TextValue
    FROM dbo.LookupTranslation lt
    WHERE lt.LookupId = b.LookupId
      AND lt.LocaleCode = @FallbackLocaleCode
      AND lt.IsActive = 1
      AND (lt.EffectiveFromUtc IS NULL OR lt.EffectiveFromUtc <= SYSUTCDATETIME())
      AND (lt.EffectiveToUtc IS NULL OR lt.EffectiveToUtc > SYSUTCDATETIME())
    ORDER BY lt.LookupTranslationId
  ) tFallback
  WHERE COALESCE(tExact.TextValue, tFallback.TextValue) IS NOT NULL
  ORDER BY b.SortOrder, b.LookupId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_Lookup_GetByKeys
  @CategoryName NVARCHAR(100),
  @LocaleCode NVARCHAR(20),
  @FallbackLocaleCode NVARCHAR(20) = N'en-US',
  @KeysJson NVARCHAR(MAX)
AS
BEGIN
  SET NOCOUNT ON;

  ;WITH requested AS (
    SELECT DISTINCT TRY_CAST([value] AS NVARCHAR(150)) AS SearchKey
    FROM OPENJSON(@KeysJson)
    WHERE TRY_CAST([value] AS NVARCHAR(150)) IS NOT NULL
  ),
  base AS (
    SELECT
      l.LookupId,
      l.DataCategoryId,
      dc.DataName,
      l.SearchKey,
      l.Comments,
      l.SortOrder
    FROM dbo.Lookup l
    INNER JOIN dbo.DataCategory dc
      ON dc.DataCategoryId = l.DataCategoryId
    INNER JOIN requested r
      ON r.SearchKey = l.SearchKey
    WHERE dc.DataName = @CategoryName
      AND dc.IsActive = 1
      AND l.IsActive = 1
      AND (l.EffectiveFromUtc IS NULL OR l.EffectiveFromUtc <= SYSUTCDATETIME())
      AND (l.EffectiveToUtc IS NULL OR l.EffectiveToUtc > SYSUTCDATETIME())
  )
  SELECT
    b.LookupId,
    b.DataCategoryId,
    b.DataName,
    b.SearchKey,
    COALESCE(tExact.TextValue, tFallback.TextValue) AS TextValue,
    b.Comments,
    b.SortOrder
  FROM base b
  OUTER APPLY (
    SELECT TOP 1 TextValue
    FROM dbo.LookupTranslation lt
    WHERE lt.LookupId = b.LookupId
      AND lt.LocaleCode = @LocaleCode
      AND lt.IsActive = 1
      AND (lt.EffectiveFromUtc IS NULL OR lt.EffectiveFromUtc <= SYSUTCDATETIME())
      AND (lt.EffectiveToUtc IS NULL OR lt.EffectiveToUtc > SYSUTCDATETIME())
    ORDER BY lt.LookupTranslationId
  ) tExact
  OUTER APPLY (
    SELECT TOP 1 TextValue
    FROM dbo.LookupTranslation lt
    WHERE lt.LookupId = b.LookupId
      AND lt.LocaleCode = @FallbackLocaleCode
      AND lt.IsActive = 1
      AND (lt.EffectiveFromUtc IS NULL OR lt.EffectiveFromUtc <= SYSUTCDATETIME())
      AND (lt.EffectiveToUtc IS NULL OR lt.EffectiveToUtc > SYSUTCDATETIME())
    ORDER BY lt.LookupTranslationId
  ) tFallback
  WHERE COALESCE(tExact.TextValue, tFallback.TextValue) IS NOT NULL
  ORDER BY b.SearchKey, b.SortOrder, b.LookupId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_Lookup_GetCategoryAll
  @CategoryName NVARCHAR(100),
  @LocaleCode NVARCHAR(20),
  @FallbackLocaleCode NVARCHAR(20) = N'en-US'
AS
BEGIN
  SET NOCOUNT ON;

  ;WITH base AS (
    SELECT
      l.LookupId,
      l.DataCategoryId,
      dc.DataName,
      l.SearchKey,
      l.Comments,
      l.SortOrder
    FROM dbo.Lookup l
    INNER JOIN dbo.DataCategory dc
      ON dc.DataCategoryId = l.DataCategoryId
    WHERE dc.DataName = @CategoryName
      AND dc.IsActive = 1
      AND l.IsActive = 1
      AND (l.EffectiveFromUtc IS NULL OR l.EffectiveFromUtc <= SYSUTCDATETIME())
      AND (l.EffectiveToUtc IS NULL OR l.EffectiveToUtc > SYSUTCDATETIME())
  )
  SELECT
    b.LookupId,
    b.DataCategoryId,
    b.DataName,
    b.SearchKey,
    COALESCE(tExact.TextValue, tFallback.TextValue) AS TextValue,
    b.Comments,
    b.SortOrder
  FROM base b
  OUTER APPLY (
    SELECT TOP 1 TextValue
    FROM dbo.LookupTranslation lt
    WHERE lt.LookupId = b.LookupId
      AND lt.LocaleCode = @LocaleCode
      AND lt.IsActive = 1
      AND (lt.EffectiveFromUtc IS NULL OR lt.EffectiveFromUtc <= SYSUTCDATETIME())
      AND (lt.EffectiveToUtc IS NULL OR lt.EffectiveToUtc > SYSUTCDATETIME())
    ORDER BY lt.LookupTranslationId
  ) tExact
  OUTER APPLY (
    SELECT TOP 1 TextValue
    FROM dbo.LookupTranslation lt
    WHERE lt.LookupId = b.LookupId
      AND lt.LocaleCode = @FallbackLocaleCode
      AND lt.IsActive = 1
      AND (lt.EffectiveFromUtc IS NULL OR lt.EffectiveFromUtc <= SYSUTCDATETIME())
      AND (lt.EffectiveToUtc IS NULL OR lt.EffectiveToUtc > SYSUTCDATETIME())
    ORDER BY lt.LookupTranslationId
  ) tFallback
  WHERE COALESCE(tExact.TextValue, tFallback.TextValue) IS NOT NULL
  ORDER BY b.SearchKey, b.SortOrder, b.LookupId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_DataCategory_Create
  @DataName NVARCHAR(100),
  @Description NVARCHAR(300) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  INSERT INTO dbo.DataCategory (DataName, Description, IsActive, CreatedAtUtc)
  VALUES (@DataName, @Description, 1, SYSUTCDATETIME());

  SELECT TOP 1 * FROM dbo.DataCategory WHERE DataCategoryId = SCOPE_IDENTITY();
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_Lookup_Create
  @CategoryName NVARCHAR(100),
  @SearchKey NVARCHAR(150),
  @LocaleCode NVARCHAR(20),
  @TextValue NVARCHAR(4000),
  @Comments NVARCHAR(4000) = NULL,
  @SortOrder INT = 0,
  @CreatedByUserNameRegistryId BIGINT = NULL
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @DataCategoryId INT;
  DECLARE @LookupId BIGINT;

  SELECT TOP 1 @DataCategoryId = DataCategoryId
  FROM dbo.DataCategory
  WHERE DataName = @CategoryName;

  IF @DataCategoryId IS NULL
  BEGIN
    RAISERROR('Lookup category not found.', 16, 1);
    RETURN;
  END;

  INSERT INTO dbo.Lookup
    (DataCategoryId, SearchKey, Comments, SortOrder, IsActive, CreatedAtUtc, CreatedByUserNameRegistryId)
  VALUES
    (@DataCategoryId, @SearchKey, @Comments, @SortOrder, 1, SYSUTCDATETIME(), @CreatedByUserNameRegistryId);

  SET @LookupId = SCOPE_IDENTITY();

  INSERT INTO dbo.LookupTranslation
    (LookupId, LocaleCode, TextValue, IsActive, CreatedAtUtc, CreatedByUserNameRegistryId)
  VALUES
    (@LookupId, @LocaleCode, @TextValue, 1, SYSUTCDATETIME(), @CreatedByUserNameRegistryId);

  SELECT @LookupId AS LookupId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_Lookup_Update
  @LookupId BIGINT,
  @SearchKey NVARCHAR(150),
  @Comments NVARCHAR(4000) = NULL,
  @SortOrder INT = 0,
  @IsActive BIT = 1
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.Lookup
  SET SearchKey = @SearchKey,
      Comments = @Comments,
      SortOrder = @SortOrder,
      IsActive = @IsActive,
      UpdatedAtUtc = SYSUTCDATETIME()
  WHERE LookupId = @LookupId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_LookupTranslation_Upsert
  @LookupId BIGINT,
  @LocaleCode NVARCHAR(20),
  @TextValue NVARCHAR(4000),
  @IsActive BIT = 1,
  @CreatedByUserNameRegistryId BIGINT = NULL
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1
    FROM dbo.LookupTranslation
    WHERE LookupId = @LookupId
      AND LocaleCode = @LocaleCode
  )
  BEGIN
    UPDATE dbo.LookupTranslation
    SET TextValue = @TextValue,
        IsActive = @IsActive,
        UpdatedAtUtc = SYSUTCDATETIME()
    WHERE LookupId = @LookupId
      AND LocaleCode = @LocaleCode;
  END
  ELSE
  BEGIN
    INSERT INTO dbo.LookupTranslation
      (LookupId, LocaleCode, TextValue, IsActive, CreatedAtUtc, CreatedByUserNameRegistryId)
    VALUES
      (@LookupId, @LocaleCode, @TextValue, @IsActive, SYSUTCDATETIME(), @CreatedByUserNameRegistryId);
  END
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_Lookup_SoftDelete
  @LookupId BIGINT
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.Lookup
  SET IsActive = 0,
      UpdatedAtUtc = SYSUTCDATETIME()
  WHERE LookupId = @LookupId;

  UPDATE dbo.LookupTranslation
  SET IsActive = 0,
      UpdatedAtUtc = SYSUTCDATETIME()
  WHERE LookupId = @LookupId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.usp_LookupTranslation_SoftDelete
  @LookupTranslationId BIGINT
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.LookupTranslation
  SET IsActive = 0,
      UpdatedAtUtc = SYSUTCDATETIME()
  WHERE LookupTranslationId = @LookupTranslationId;
END;
GO

DECLARE @UiLabelCategoryId INT;
DECLARE @UiMessageCategoryId INT;
DECLARE @UiPlaceholderCategoryId INT;

SELECT TOP 1 @UiLabelCategoryId = DataCategoryId FROM dbo.DataCategory WHERE DataName = N'UI_LABEL';
SELECT TOP 1 @UiMessageCategoryId = DataCategoryId FROM dbo.DataCategory WHERE DataName = N'UI_MESSAGE';
SELECT TOP 1 @UiPlaceholderCategoryId = DataCategoryId FROM dbo.DataCategory WHERE DataName = N'UI_PLACEHOLDER';

IF @UiLabelCategoryId IS NOT NULL
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dbo.Lookup
    WHERE DataCategoryId = @UiLabelCategoryId
      AND SearchKey = N'pricing.page.title'
      AND SortOrder = 0
  )
  BEGIN
    INSERT INTO dbo.Lookup (DataCategoryId, SearchKey, Comments, SortOrder, IsActive, CreatedAtUtc)
    VALUES
      (@UiLabelCategoryId, N'pricing.page.title', N'Pricing page title', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'pricing.page.subtitle', N'Pricing page subtitle', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'pricing.back.button', N'Back to dashboard button text', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'pricing.admin.title', N'Admin plan configuration heading', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'pricing.admin.subtitle', N'Admin plan configuration help text', 0, 1, SYSUTCDATETIME());
  END;

  MERGE dbo.LookupTranslation AS target
  USING (
    SELECT l.LookupId, v.LocaleCode, v.TextValue
    FROM dbo.Lookup l
    INNER JOIN (VALUES
      (N'pricing.page.title', N'en-US', N'Upgrade Your Plan'),
      (N'pricing.page.subtitle', N'en-US', N'Teacher monetization plans'),
      (N'pricing.back.button', N'en-US', N'Back to Dashboard'),
      (N'pricing.admin.title', N'en-US', N'Admin Plan Configuration'),
      (N'pricing.admin.subtitle', N'en-US', N'Update plan price, limits, duration, and active status.')
    ) v(SearchKey, LocaleCode, TextValue)
      ON l.SearchKey = v.SearchKey
    WHERE l.DataCategoryId = @UiLabelCategoryId
  ) AS src
  ON target.LookupId = src.LookupId AND target.LocaleCode = src.LocaleCode
  WHEN MATCHED THEN
    UPDATE SET
      target.TextValue = src.TextValue,
      target.IsActive = 1,
      target.UpdatedAtUtc = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN
    INSERT (LookupId, LocaleCode, TextValue, IsActive, CreatedAtUtc)
    VALUES (src.LookupId, src.LocaleCode, src.TextValue, 1, SYSUTCDATETIME());
END;

IF @UiLabelCategoryId IS NOT NULL
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dbo.Lookup
    WHERE DataCategoryId = @UiLabelCategoryId
      AND SearchKey = N'sidebar.selectStudent'
  )
  BEGIN
    INSERT INTO dbo.Lookup (DataCategoryId, SearchKey, Comments, SortOrder, IsActive, CreatedAtUtc)
    VALUES
      (@UiLabelCategoryId, N'sidebar.selectStudent', N'Sidebar select student label', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'sidebar.createStudent', N'Sidebar create student button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'sidebar.importStudents', N'Sidebar import students button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'sidebar.myClasses', N'Sidebar classes section title', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'sidebar.myResults', N'Sidebar my results button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'sidebar.joinCode', N'Sidebar join code label', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'sidebar.createQuiz', N'Sidebar create quiz link', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'sidebar.notesFlashcards', N'Sidebar notes flash cards link', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'sidebar.previousFlashcards', N'Sidebar previous flash cards link', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'sidebar.createFromAiHistory', N'Sidebar create from AI history link', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'sidebar.deleteClass', N'Sidebar delete class button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'sidebar.createClass', N'Sidebar create class button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'sidebar.profile', N'Sidebar profile button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'sidebar.logout', N'Sidebar logout button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'sidebar.loading', N'Sidebar loading label', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'sidebar.noStudents', N'Sidebar no students option', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'sidebar.upgrade.button', N'Sidebar upgrade button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'sidebar.close.button', N'Sidebar close button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'sidebar.upgradeModal.title', N'Sidebar upgrade modal title', 0, 1, SYSUTCDATETIME());
  END;

  MERGE dbo.LookupTranslation AS target
  USING (
    SELECT l.LookupId, v.LocaleCode, v.TextValue
    FROM dbo.Lookup l
    INNER JOIN (VALUES
      (N'sidebar.selectStudent', N'en-US', N'Select Student'),
      (N'sidebar.createStudent', N'en-US', N'Create Student'),
      (N'sidebar.importStudents', N'en-US', N'Import Students (Excel)'),
      (N'sidebar.myClasses', N'en-US', N'MY CLASSES'),
      (N'sidebar.myResults', N'en-US', N'My Results'),
      (N'sidebar.joinCode', N'en-US', N'Join code'),
      (N'sidebar.createQuiz', N'en-US', N'Create Quiz'),
      (N'sidebar.notesFlashcards', N'en-US', N'Notes / Flash Cards'),
      (N'sidebar.previousFlashcards', N'en-US', N'Previous Flash Cards'),
      (N'sidebar.createFromAiHistory', N'en-US', N'Create From AI History'),
      (N'sidebar.deleteClass', N'en-US', N'Delete Class'),
      (N'sidebar.createClass', N'en-US', N'Create Class'),
      (N'sidebar.profile', N'en-US', N'Profile'),
      (N'sidebar.logout', N'en-US', N'Logout'),
      (N'sidebar.loading', N'en-US', N'Loading...'),
      (N'sidebar.noStudents', N'en-US', N'No students'),
      (N'sidebar.upgrade.button', N'en-US', N'Upgrade'),
      (N'sidebar.close.button', N'en-US', N'Close'),
      (N'sidebar.upgradeModal.title', N'en-US', N'AI Practice Locked After Trial')
    ) v(SearchKey, LocaleCode, TextValue)
      ON l.SearchKey = v.SearchKey
    WHERE l.DataCategoryId = @UiLabelCategoryId
  ) AS src
  ON target.LookupId = src.LookupId AND target.LocaleCode = src.LocaleCode
  WHEN MATCHED THEN
    UPDATE SET target.TextValue = src.TextValue, target.IsActive = 1, target.UpdatedAtUtc = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN
    INSERT (LookupId, LocaleCode, TextValue, IsActive, CreatedAtUtc)
    VALUES (src.LookupId, src.LocaleCode, src.TextValue, 1, SYSUTCDATETIME());
END;

IF @UiMessageCategoryId IS NOT NULL
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dbo.Lookup
    WHERE DataCategoryId = @UiMessageCategoryId
      AND SearchKey = N'sidebar.error.failedStudents'
  )
  BEGIN
    INSERT INTO dbo.Lookup (DataCategoryId, SearchKey, Comments, SortOrder, IsActive, CreatedAtUtc)
    VALUES
      (@UiMessageCategoryId, N'sidebar.error.failedStudents', N'Sidebar failed students message', 0, 1, SYSUTCDATETIME()),
      (@UiMessageCategoryId, N'sidebar.error.failedClasses', N'Sidebar failed classes message', 0, 1, SYSUTCDATETIME()),
      (@UiMessageCategoryId, N'sidebar.error.createClassFirst', N'Sidebar create class first message', 0, 1, SYSUTCDATETIME()),
      (@UiMessageCategoryId, N'sidebar.search.empty', N'Sidebar search empty message', 0, 1, SYSUTCDATETIME()),
      (@UiMessageCategoryId, N'sidebar.upgradeModal.body', N'Sidebar upgrade modal body', 0, 1, SYSUTCDATETIME()),
      (@UiMessageCategoryId, N'sidebar.upgradeModal.studentBasic', N'Sidebar upgrade modal basic plan bullet', 0, 1, SYSUTCDATETIME()),
      (@UiMessageCategoryId, N'sidebar.upgradeModal.studentPro', N'Sidebar upgrade modal pro plan bullet', 0, 1, SYSUTCDATETIME());
  END;

  MERGE dbo.LookupTranslation AS target
  USING (
    SELECT l.LookupId, v.LocaleCode, v.TextValue
    FROM dbo.Lookup l
    INNER JOIN (VALUES
      (N'sidebar.error.failedStudents', N'en-US', N'Failed to load students'),
      (N'sidebar.error.failedClasses', N'en-US', N'Failed to load classes'),
      (N'sidebar.error.createClassFirst', N'en-US', N'Create a student first, then create a class.'),
      (N'sidebar.search.empty', N'en-US', N'No classes or quizzes found for'),
      (N'sidebar.upgradeModal.body', N'en-US', N'Your free student trial has ended. Upgrade to unlock AI Practice, higher monthly limits, and advanced analytics.'),
      (N'sidebar.upgradeModal.studentBasic', N'en-US', N'Student Basic: 50 AI practice quizzes/month'),
      (N'sidebar.upgradeModal.studentPro', N'en-US', N'Student Pro: 200 AI practice quizzes/month + advanced analytics')
    ) v(SearchKey, LocaleCode, TextValue)
      ON l.SearchKey = v.SearchKey
    WHERE l.DataCategoryId = @UiMessageCategoryId
  ) AS src
  ON target.LookupId = src.LookupId AND target.LocaleCode = src.LocaleCode
  WHEN MATCHED THEN
    UPDATE SET target.TextValue = src.TextValue, target.IsActive = 1, target.UpdatedAtUtc = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN
    INSERT (LookupId, LocaleCode, TextValue, IsActive, CreatedAtUtc)
    VALUES (src.LookupId, src.LocaleCode, src.TextValue, 1, SYSUTCDATETIME());
END;

IF @UiLabelCategoryId IS NOT NULL
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dbo.Lookup
    WHERE DataCategoryId = @UiLabelCategoryId
      AND SearchKey = N'quiz.loading'
      AND SortOrder = 0
  )
  BEGIN
    INSERT INTO dbo.Lookup (DataCategoryId, SearchKey, Comments, SortOrder, IsActive, CreatedAtUtc)
    VALUES
      (@UiLabelCategoryId, N'quiz.loading', N'Quiz loading state', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.noQuizFound', N'No quiz found message', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.timeLeft.label', N'Time left label', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.pause.button', N'Pause timer button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.resume.button', N'Resume timer button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.downloadPdf.button', N'Download quiz PDF button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.downloadSolvedPdf.button', N'Download solved quiz PDF button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.submit.button', N'Submit quiz button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.submitting.button', N'Submitting quiz button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.clear.button', N'Clear quiz answers button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.showHint.button', N'Show hint button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.hideHint.button', N'Hide hint button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.result.title', N'Quiz result title', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.showExplanations.button', N'Show explanations button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.hideExplanations.button', N'Hide explanations button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.startNextAttempt.button', N'Start next attempt button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.explanation.title', N'Explanation panel title', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.diagram.title', N'Diagram panel title', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.notAnswered', N'Question not answered label', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.questionType.mcq', N'MCQ question type label', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.questionType.short', N'Short question type label', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.questionType.trueFalse', N'True/False question type label', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.questionType.numeric', N'Numeric question type label', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'quiz.questionType.long', N'Long question type label', 0, 1, SYSUTCDATETIME());
  END;

  MERGE dbo.LookupTranslation AS target
  USING (
    SELECT l.LookupId, v.LocaleCode, v.TextValue
    FROM dbo.Lookup l
    INNER JOIN (VALUES
      (N'quiz.loading', N'en-US', N'Loading quiz...'),
      (N'quiz.noQuizFound', N'en-US', N'No quiz found.'),
      (N'quiz.timeLeft.label', N'en-US', N'Time Left'),
      (N'quiz.pause.button', N'en-US', N'Pause'),
      (N'quiz.resume.button', N'en-US', N'Resume'),
      (N'quiz.downloadPdf.button', N'en-US', N'Download Quiz PDF'),
      (N'quiz.downloadSolvedPdf.button', N'en-US', N'Download Solved Quiz PDF'),
      (N'quiz.submit.button', N'en-US', N'Submit Quiz'),
      (N'quiz.submitting.button', N'en-US', N'Submitting...'),
      (N'quiz.clear.button', N'en-US', N'Clear'),
      (N'quiz.showHint.button', N'en-US', N'Show Hint (3 steps)'),
      (N'quiz.hideHint.button', N'en-US', N'Hide Hint'),
      (N'quiz.result.title', N'en-US', N'Result'),
      (N'quiz.showExplanations.button', N'en-US', N'Show Explanations'),
      (N'quiz.hideExplanations.button', N'en-US', N'Hide Explanations'),
      (N'quiz.startNextAttempt.button', N'en-US', N'Start Next Attempt'),
      (N'quiz.explanation.title', N'en-US', N'Explanation'),
      (N'quiz.diagram.title', N'en-US', N'Diagram'),
      (N'quiz.notAnswered', N'en-US', N'Not answered'),
      (N'quiz.questionType.mcq', N'en-US', N'MCQ'),
      (N'quiz.questionType.short', N'en-US', N'Short'),
      (N'quiz.questionType.trueFalse', N'en-US', N'True/False'),
      (N'quiz.questionType.numeric', N'en-US', N'Numeric'),
      (N'quiz.questionType.long', N'en-US', N'Long')
    ) v(SearchKey, LocaleCode, TextValue)
      ON l.SearchKey = v.SearchKey
    WHERE l.DataCategoryId = @UiLabelCategoryId
  ) AS src
  ON target.LookupId = src.LookupId AND target.LocaleCode = src.LocaleCode
  WHEN MATCHED THEN
    UPDATE SET
      target.TextValue = src.TextValue,
      target.IsActive = 1,
      target.UpdatedAtUtc = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN
    INSERT (LookupId, LocaleCode, TextValue, IsActive, CreatedAtUtc)
    VALUES (src.LookupId, src.LocaleCode, src.TextValue, 1, SYSUTCDATETIME());
END;

IF @UiMessageCategoryId IS NOT NULL
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dbo.Lookup
    WHERE DataCategoryId = @UiMessageCategoryId
      AND SearchKey = N'quiz.selectStudent.error'
      AND SortOrder = 0
  )
  BEGIN
    INSERT INTO dbo.Lookup (DataCategoryId, SearchKey, Comments, SortOrder, IsActive, CreatedAtUtc)
    VALUES
      (@UiMessageCategoryId, N'quiz.selectStudent.error', N'Manager must select a student first', 0, 1, SYSUTCDATETIME()),
      (@UiMessageCategoryId, N'quiz.noQuestions.error', N'Quiz has no questions', 0, 1, SYSUTCDATETIME()),
      (@UiMessageCategoryId, N'quiz.submitIncomplete.error', N'Please answer all questions before submitting', 0, 1, SYSUTCDATETIME()),
      (@UiMessageCategoryId, N'quiz.timeUp.error', N'Time is up autosubmit message', 0, 1, SYSUTCDATETIME()),
      (@UiMessageCategoryId, N'quiz.paidFeatureOnly.error', N'Paid feature locked message', 0, 1, SYSUTCDATETIME()),
      (@UiMessageCategoryId, N'quiz.hiddenForStudents.label', N'Hidden for students label', 0, 1, SYSUTCDATETIME()),
      (@UiMessageCategoryId, N'quiz.noExplanation.label', N'No explanation label', 0, 1, SYSUTCDATETIME()),
      (@UiMessageCategoryId, N'quiz.hintPrompt.label', N'Hint prompt label', 0, 1, SYSUTCDATETIME());
  END;

  MERGE dbo.LookupTranslation AS target
  USING (
    SELECT l.LookupId, v.LocaleCode, v.TextValue
    FROM dbo.Lookup l
    INNER JOIN (VALUES
      (N'quiz.selectStudent.error', N'en-US', N'Select a student from sidebar before starting quiz.'),
      (N'quiz.noQuestions.error', N'en-US', N'Quiz has no questions yet. Add questions before attempting.'),
      (N'quiz.submitIncomplete.error', N'en-US', N'Please answer all questions before submitting.'),
      (N'quiz.timeUp.error', N'en-US', N'Time is up. Submitting your quiz now.'),
      (N'quiz.paidFeatureOnly.error', N'en-US', N'This feature is available in paid version.'),
      (N'quiz.hiddenForStudents.label', N'en-US', N'Hidden for students (teacher preview only)'),
      (N'quiz.noExplanation.label', N'en-US', N'No explanation.'),
      (N'quiz.hintPrompt.label', N'en-US', N'Click "Show Hint (3 steps)" below to view a short hint before test.')
    ) v(SearchKey, LocaleCode, TextValue)
      ON l.SearchKey = v.SearchKey
    WHERE l.DataCategoryId = @UiMessageCategoryId
  ) AS src
  ON target.LookupId = src.LookupId AND target.LocaleCode = src.LocaleCode
  WHEN MATCHED THEN
    UPDATE SET
      target.TextValue = src.TextValue,
      target.IsActive = 1,
      target.UpdatedAtUtc = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN
    INSERT (LookupId, LocaleCode, TextValue, IsActive, CreatedAtUtc)
    VALUES (src.LookupId, src.LocaleCode, src.TextValue, 1, SYSUTCDATETIME());
END;

IF @UiPlaceholderCategoryId IS NOT NULL
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dbo.Lookup
    WHERE DataCategoryId = @UiPlaceholderCategoryId
      AND SearchKey = N'quiz.answer.numeric.placeholder'
      AND SortOrder = 0
  )
  BEGIN
    INSERT INTO dbo.Lookup (DataCategoryId, SearchKey, Comments, SortOrder, IsActive, CreatedAtUtc)
    VALUES
      (@UiPlaceholderCategoryId, N'quiz.answer.numeric.placeholder', N'Numeric answer placeholder', 0, 1, SYSUTCDATETIME()),
      (@UiPlaceholderCategoryId, N'quiz.answer.long.placeholder', N'Long answer placeholder', 0, 1, SYSUTCDATETIME()),
      (@UiPlaceholderCategoryId, N'quiz.answer.short.placeholder', N'Short answer placeholder', 0, 1, SYSUTCDATETIME());
  END;

  MERGE dbo.LookupTranslation AS target
  USING (
    SELECT l.LookupId, v.LocaleCode, v.TextValue
    FROM dbo.Lookup l
    INNER JOIN (VALUES
      (N'quiz.answer.numeric.placeholder', N'en-US', N'Enter numeric answer'),
      (N'quiz.answer.long.placeholder', N'en-US', N'Write your answer'),
      (N'quiz.answer.short.placeholder', N'en-US', N'Enter short answer')
    ) v(SearchKey, LocaleCode, TextValue)
      ON l.SearchKey = v.SearchKey
    WHERE l.DataCategoryId = @UiPlaceholderCategoryId
  ) AS src
  ON target.LookupId = src.LookupId AND target.LocaleCode = src.LocaleCode
  WHEN MATCHED THEN
    UPDATE SET
      target.TextValue = src.TextValue,
      target.IsActive = 1,
      target.UpdatedAtUtc = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN
    INSERT (LookupId, LocaleCode, TextValue, IsActive, CreatedAtUtc)
    VALUES (src.LookupId, src.LocaleCode, src.TextValue, 1, SYSUTCDATETIME());
END;

IF @UiLabelCategoryId IS NOT NULL
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dbo.Lookup
    WHERE DataCategoryId = @UiLabelCategoryId
      AND SearchKey = N'layout.header.role'
  )
  BEGIN
    INSERT INTO dbo.Lookup (DataCategoryId, SearchKey, Comments, SortOrder, IsActive, CreatedAtUtc)
    VALUES
      (@UiLabelCategoryId, N'layout.header.role', N'Header role chip label', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'layout.header.currentStudent', N'Header current student chip label', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'layout.header.user', N'Header user chip label', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'layout.header.planDetails', N'Header plan details chip label', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'layout.search.placeholder', N'Header search placeholder', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'layout.upgrade.button', N'Header upgrade button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'layout.menu.button', N'Mobile menu button', 0, 1, SYSUTCDATETIME()),
      (@UiLabelCategoryId, N'layout.brand.title', N'Mobile brand title', 0, 1, SYSUTCDATETIME());
  END;

  MERGE dbo.LookupTranslation AS target
  USING (
    SELECT l.LookupId, v.LocaleCode, v.TextValue
    FROM dbo.Lookup l
    INNER JOIN (VALUES
      (N'layout.header.role', N'en-US', N'Role'),
      (N'layout.header.currentStudent', N'en-US', N'Current Student'),
      (N'layout.header.user', N'en-US', N'User'),
      (N'layout.header.planDetails', N'en-US', N'Plan Details'),
      (N'layout.search.placeholder', N'en-US', N'Search quizzes, classes, topics...'),
      (N'layout.upgrade.button', N'en-US', N'Upgrade'),
      (N'layout.menu.button', N'en-US', N'Menu'),
      (N'layout.brand.title', N'en-US', N'AI MCQ Classroom')
    ) v(SearchKey, LocaleCode, TextValue)
      ON l.SearchKey = v.SearchKey
    WHERE l.DataCategoryId = @UiLabelCategoryId
  ) AS src
  ON target.LookupId = src.LookupId AND target.LocaleCode = src.LocaleCode
  WHEN MATCHED THEN
    UPDATE SET target.TextValue = src.TextValue, target.IsActive = 1, target.UpdatedAtUtc = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN
    INSERT (LookupId, LocaleCode, TextValue, IsActive, CreatedAtUtc)
    VALUES (src.LookupId, src.LocaleCode, src.TextValue, 1, SYSUTCDATETIME());
END;
