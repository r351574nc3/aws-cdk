import * as iam from '@aws-cdk/aws-iam';
import * as kms from '@aws-cdk/aws-kms';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import * as cdk from '@aws-cdk/core';
import { Construct } from 'constructs';
import { integrationResourceArn, validatePatternSupported } from '../private/task-utils';

/**
 * Properties for starting a Query Execution
 * @experimental
 */
export interface AthenaStartQueryExecutionProps extends sfn.TaskStateBaseProps {
  /**
   * Query that will be started
   */
  readonly queryString: string;

  /**
   * Unique string string to ensure idempotence
   *
   * @default - No client request token
   */
  readonly clientRequestToken?: string;

  /**
   * Database within which query executes
   *
   * @default - No query execution context
   */
  readonly queryExecutionContext?: QueryExecutionContext;

  /**
   * Configuration on how and where to save query
   *
   * @default - No result configuration
   */
  readonly resultConfiguration?: ResultConfiguration;

  /**
   * Configuration on how and where to save query
   *
   * @default - No work group
   */
  readonly workGroup?: string;
}

/**
 * Start an Athena Query as a Task
 *
 * @see https://docs.aws.amazon.com/step-functions/latest/dg/connect-athena.html
 * @experimental
 */
export class AthenaStartQueryExecution extends sfn.TaskStateBase {

  private static readonly SUPPORTED_INTEGRATION_PATTERNS: sfn.IntegrationPattern[] = [
    sfn.IntegrationPattern.REQUEST_RESPONSE,
    sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
  ];

  protected readonly taskMetrics?: sfn.TaskMetricsConfig;
  protected readonly taskPolicies?: iam.PolicyStatement[];

  private readonly integrationPattern: sfn.IntegrationPattern;

  constructor(scope: Construct, id: string, private readonly props: AthenaStartQueryExecutionProps) {
    super(scope, id, props);
    this.integrationPattern = props.integrationPattern ?? sfn.IntegrationPattern.REQUEST_RESPONSE;

    validatePatternSupported(this.integrationPattern, AthenaStartQueryExecution.SUPPORTED_INTEGRATION_PATTERNS);

    this.taskPolicies = this.createPolicyStatements();
  }

  private createPolicyStatements(): iam.PolicyStatement[] {
    const policyStatements = [
      new iam.PolicyStatement({
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'athena',
            resource: 'datacatalog',
            resourceName: this.props.queryExecutionContext?.catalogName ?? 'AwsDataCatalog',
          }),
          cdk.Stack.of(this).formatArn({
            service: 'athena',
            resource: 'workgroup',
            resourceName: this.props.workGroup ?? 'primary',
          }),

        ],
        actions: ['athena:getDataCatalog', 'athena:startQueryExecution'],
      }),
    ];

    policyStatements.push(
      new iam.PolicyStatement({
        actions: ['s3:AbortMultipartUpload',
          's3:CreateBucket',
          's3:GetBucketLocation',
          's3:GetObject',
          's3:ListBucket',
          's3:ListBucketMultipartUploads',
          's3:ListMultipartUploadParts',
          's3:PutObject'],
        resources: [this.props.resultConfiguration?.outputLocation ?? '*'], // Need S3 location where data is stored https://docs.aws.amazon.com/athena/latest/ug/security-iam-athena.html
      }),
    );

    policyStatements.push(
      new iam.PolicyStatement({
        actions: ['lakeformation:GetDataAccess'],
        resources: [this.props.resultConfiguration?.outputLocation ?? '*'], // Workflow role permissions https://docs.aws.amazon.com/lake-formation/latest/dg/permissions-reference.html
      }),
    );

    policyStatements.push(
      new iam.PolicyStatement({
        actions: ['glue:BatchCreatePartition',
          'glue:BatchDeletePartition',
          'glue:BatchDeleteTable',
          'glue:BatchGetPartition',
          'glue:CreateDatabase',
          'glue:CreatePartition',
          'glue:CreateTable',
          'glue:DeleteDatabase',
          'glue:DeletePartition',
          'glue:DeleteTable',
          'glue:GetDatabase',
          'glue:GetDatabases',
          'glue:GetPartition',
          'glue:GetPartitions',
          'glue:GetTable',
          'glue:GetTables',
          'glue:UpdateDatabase',
          'glue:UpdatePartition',
          'glue:UpdateTable'],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'glue',
            resource: 'catalog',
          }),
          cdk.Stack.of(this).formatArn({
            service: 'glue',
            resource: 'database',
            resourceName: this.props.queryExecutionContext?.databaseName ?? 'default',
          }),
          cdk.Stack.of(this).formatArn({
            service: 'glue',
            resource: 'table',
            resourceName: (this.props.queryExecutionContext?.databaseName ?? 'default') + '/*', // grant access to all tables in the specified or default database to prevent cross database access https://docs.aws.amazon.com/IAM/latest/UserGuide/list_awsglue.html
          }),
          cdk.Stack.of(this).formatArn({
            service: 'glue',
            resource: 'userdefinedfunction',
            resourceName: (this.props.queryExecutionContext?.databaseName ?? 'default') + '/*', // grant access to get all user defined functions for the particular database in the request or the default database https://docs.aws.amazon.com/IAM/latest/UserGuide/list_awsglue.html
          }),
        ],
      }),
    );

    return policyStatements;
  }

  /**
   * Provides the Athena start query execution service integration task configuration
   */
  /**
   * @internal
   */
  protected _renderTask(): any {
    return {
      Resource: integrationResourceArn('athena', 'startQueryExecution', this.integrationPattern),
      Parameters: sfn.FieldUtils.renderObject({
        QueryString: this.props.queryString,
        ClientRequestToken: this.props.clientRequestToken,
        QueryExecutionContext: {
          Catalog: this.props.queryExecutionContext?.catalogName,
          Database: this.props.queryExecutionContext?.databaseName,
        },
        ResultConfiguration: {
          EncryptionConfiguration: {
            EncryptionOption: this.props.resultConfiguration?.encryptionConfiguration?.encryptionOption,
            KmsKey: this.props.resultConfiguration?.encryptionConfiguration?.encryptionKey,
          },
          OutputLocation: this.props.resultConfiguration?.outputLocation,
        },
        WorkGroup: this.props.workGroup,
      }),
    };
  }
}

/**
 * Location of query result along with S3 bucket configuration
 *
 * @see https://docs.aws.amazon.com/athena/latest/APIReference/API_ResultConfiguration.html
 * @experimental
 */
export interface ResultConfiguration {

  /**
   * S3 path of query results
   *
   * @default - Query Result Location set in Athena settings for this workgroup
   * @example s3://query-results-bucket/folder/
  */
  readonly outputLocation?: string;

  /**
   * Encryption option used if enabled in S3
   *
   * @default - SSE_S3 encrpytion is enabled with default encryption key
   */
  readonly encryptionConfiguration?: EncryptionConfiguration
}

/**
 * Encryption Configuration of the S3 bucket
 *
 * @see https://docs.aws.amazon.com/athena/latest/APIReference/API_EncryptionConfiguration.html
 * @experimental
 */
export interface EncryptionConfiguration {

  /**
   * Type of S3 server-side encryption enabled
   *
   * @default EncryptionOption.S3_MANAGED
   */
  readonly encryptionOption: EncryptionOption;

  /**
   * KMS key ARN or ID
   *
   * @default - No KMS key for Encryption Option SSE_S3 and default master key for Encryption Option SSE_KMS and CSE_KMS
   */
  readonly encryptionKey?: kms.IKey;
}

/**
 * Encryption Options of the S3 bucket
 *
 * @see https://docs.aws.amazon.com/athena/latest/APIReference/API_EncryptionConfiguration.html#athena-Type-EncryptionConfiguration-EncryptionOption
 * @experimental
 */
export enum EncryptionOption {
  /**
   * Server side encryption (SSE) with an Amazon S3-managed key.
   *
   * @see https://docs.aws.amazon.com/AmazonS3/latest/dev/UsingServerSideEncryption.html
   */
  S3_MANAGED = 'SSE_S3',

  /**
   * Server-side encryption (SSE) with an AWS KMS key managed by the account owner.
   *
   * @see https://docs.aws.amazon.com/AmazonS3/latest/dev/UsingKMSEncryption.html
   */
  KMS = 'SSE_KMS',

  /**
   * Client-side encryption (CSE) with an AWS KMS key managed by the account owner.
   *
   * @see https://docs.aws.amazon.com/AmazonS3/latest/dev/UsingClientSideEncryption.html
   */
  CLIENT_SIDE_KMS = 'CSE_KMS'
}

/**
 * Database and data catalog context in which the query execution occurs
 *
 * @see https://docs.aws.amazon.com/athena/latest/APIReference/API_QueryExecutionContext.html
 * @experimental
 */
export interface QueryExecutionContext {

  /**
   * Name of catalog used in query execution
   *
   * @default - No catalog
   */
  readonly catalogName?: string;

  /**
   * Name of database used in query execution
   *
   * @default - No database
   */
  readonly databaseName?: string;
}