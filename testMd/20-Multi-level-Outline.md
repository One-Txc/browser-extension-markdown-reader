# Data Platform Architecture Design

This document describes the overall architecture, storage choices, data models and governance of the data platform, as the team's internal technical baseline.

> This file exercises multi-level folding in the sidebar outline: headings span H1–H5 and include
> consecutive siblings, skipped levels, deep nesting (H1→H2→H3→H4→H5), and jumps back up
> from deep levels to shallow ones.

## 1. Overall Architecture

The platform is organised in layers, with data refined step by step from staging to serving.

### 1.1 Layered Design

Layering is the most fundamental organising principle of a warehouse: each layer depends only on the one below it.

#### 1.1.1 Staging Layer (ODS)

The staging layer keeps source-system data exactly as it arrived, with no cleaning or transformation, so problems can be traced back.

#### 1.1.2 Detail Layer (DWD)

The detail layer handles de-duplication, encoding conversion and field standardisation. Everything downstream is built on it.

#### 1.1.3 Summary Layer (DWS)

The summary layer aggregates by subject area and is the main source for downstream reports and models.

##### 1.1.3.1 Partition Strategy

Partitioned by a single business-date field, keeping the last three years; older partitions are archived to cold storage.

##### 1.1.3.2 Refresh Mode

Full overwrite for most tables; high-volume subjects switch to incremental merge so long-tail jobs do not stall the scheduler.

#### 1.1.4 Application Layer (ADS)

The application layer serves reports, APIs and model training directly, and may mix several storage forms.

### 1.2 Data Flow

Batch processing dominates, with a real-time path alongside it; the two meet at the detail layer.

#### 1.2.1 Batch Path

Scheduled at T+1 and run overnight, adding roughly 2 TB per day.

#### 1.2.2 Real-time Path

Serves risk control and live monitoring, with an end-to-end latency target under 5 minutes.

### 1.3 Technology Overview

Spark handles most computation; Presto and ClickHouse split query workloads by scenario.

## 2. Storage Choices

Different layers have very different storage needs — no single store fits every scenario.

### 2.1 Offline Storage

Holds the full history, prioritising cost and throughput.

#### 2.1.1 Hive

The most mature option with a complete ecosystem, well suited to large sequential scans.

#### 2.1.2 Hudi

Supports incremental updates and time travel, used for detail tables that change frequently.

#### 2.1.3 Iceberg

A more open table format with better hidden partitioning and snapshot management; the default for new tables.

### 2.2 Real-time Storage

Built for high write concurrency and low-latency point lookups.

#### 2.2.1 Kafka

Acts as the buffer and distribution layer of the real-time path, with retention configured per topic.

#### 2.2.2 Redis

Serves dimension caching and leaderboard-style workloads; watch the memory watermark.

#### 2.2.3 HBase

Used for very wide tables that need random reads and writes by row key.

### 2.3 Query Engines

#### 2.3.1 Presto

The workhorse for interactive analysis and federated queries across sources.

#### 2.3.2 ClickHouse

Extremely fast at single-table aggregation, ideal for fixed-dimension dashboards.

#### 2.3.3 Spark SQL

The default for batch and ETL, and capable of handling some ad-hoc queries too.

## 3. Data Model

### 3.1 Dimensional Modelling

Dimensional models dominate, with wide tables filling in where they make querying easier.

#### 3.1.1 Fact Tables

Divided by business process; once the grain is fixed it is not changed lightly.

#### 3.1.2 Dimension Tables

Slowly changing dimensions are implemented uniformly as zipper tables.

#### 3.1.3 Conformed Dimensions

Dimensions shared across subject areas must use one encoding, or definitions drift apart.

### 3.2 Wide Table Design

Wide tables reduce downstream query complexity, but column growth has to be kept in check.

#### 3.2.1 When to Split

Consider splitting when a table exceeds 200 columns or grows by more than 500 million rows a day.

#### 3.2.2 Redundant Fields

Every redundant field must record its origin and be covered by lineage tracking.

### 3.3 Subject Areas

Divided by business process into four areas: transactions, users, products and traffic.

#### 3.3.1 Transactions

Covers the whole chain of ordering, payment and refunds.

#### 3.3.2 Users

Covers registration, sign-in, profiles and tags.

### 3.4 Skipped Level Test

This section deliberately skips H3 and jumps straight from H2 to H4, to check the outline when a level is missing.

#### 3.4.1 First H4 After the Jump

It should appear in the outline as a direct child of "Skipped Level Test".

#### 3.4.2 Second H4 After the Jump

A sibling of the previous one.

## 4. Data Quality

Quality is the lifeblood of a data platform; rules, monitoring and lineage have to work together.

### 4.1 Validation Rules

#### 4.1.1 Null Checks

Primary keys and critical business fields must not be null.

#### 4.1.2 Enum Checks

Status fields must take values from a whitelist.

#### 4.1.3 Range Checks

Numeric fields such as amounts and ratings need upper and lower bounds.

#### 4.1.4 Uniqueness Checks

Business keys must not repeat in the target table.

#### 4.1.5 Consistency Checks

Fields joined across tables must use the same definition — order amount and payment amount, for example.

### 4.2 Monitoring and Alerting

Volume thresholds are configured per table; breaches raise an alert in the team chat.

#### 4.2.1 Volume Monitoring

Alert when the day-over-day change exceeds 30%.

#### 4.2.2 Timeliness Monitoring

Escalate the alert level when a job misses its SLA.

### 4.3 Lineage

Field-level lineage is collected automatically by parsing SQL, with manually maintained mappings as a fallback.

## 5. Scheduling and Governance

### 5.1 Scheduler

A single in-house scheduling platform, supporting dependency graphs, reruns and backfills.

#### 5.1.1 Task Dependencies

Dependencies are derived from lineage automatically, and can also be adjusted by hand.

#### 5.1.2 Rerun Policy

Retry three times automatically, then hand over to a human.

#### 5.1.3 Backfill Process

Backfills require approval, so a full refresh cannot overwhelm the cluster.

### 5.2 Resource Management

#### 5.2.1 Queue Layout

Queues are split by priority into real-time, core and offline.

#### 5.2.2 Isolation

Core jobs and exploratory queries are physically isolated so they cannot affect each other.

### 5.3 Access Control

#### 5.3.1 Table-level

Granted by project and role, following least privilege.

#### 5.3.2 Row-level

Filtered by tenant ID in multi-tenant scenarios.

#### 5.3.3 Column-level

Sensitive fields are granted separately and access is audited.

#### 5.3.4 Masking

Phone numbers, ID numbers and similar fields are masked dynamically at query time.

## 6. Performance

### 6.1 Storage

#### 6.1.1 Partition Pruning

Queries must carry a partition predicate, or they scan the whole table.

##### 6.1.1.1 Dynamic Partitioning

The partition is decided from the data itself at write time, which suits scattered sources.

#### 6.1.2 Small-file Compaction

Compact small files on a schedule to keep the file count per partition reasonable.

#### 6.1.3 Compression

ZSTD throughout — a good balance between ratio and decompression speed.

### 6.2 Computation

#### 6.2.1 Data Skew

Salt hot keys to spread the load, or handle skewed partitions separately.

#### 6.2.2 Broadcast Join

Broadcasting a small table avoids a shuffle, but cap the broadcast size.

#### 6.2.3 Dynamic Partition Pruning

Narrow the scan of the large table at runtime using the small table's result.

### 6.3 Queries

#### 6.3.1 Predicate Pushdown

Push filters down to the storage layer wherever possible.

#### 6.3.2 Index Selection

Bitmap indexes for point lookups; range scans rely on partitioning and sort keys.

## 7. Cost Governance

### 7.1 Storage Cost

Archive cold data promptly and tier replica counts by importance.

### 7.2 Compute Cost

Track consumption per queue to identify inefficient jobs.

#### 7.2.1 Spotting Inefficient Jobs

Prioritise jobs whose scan volume is clearly out of proportion to their output.

#### 7.2.2 Reclaiming Over-provisioned Resources

Reclaim resources that have been reserved for a long time but run below 30% utilisation.

### 7.3 Cost Allocation

Allocated by project and business line; the bill goes to each owner monthly.

## 8. Roadmap

### 8.1 Near Term

Unify the definitions used in the detail layer and complete lineage coverage.

### 8.2 Mid Term

Move to a lakehouse architecture to cut down on data movement.

### 8.3 Long Term

Build self-service data access to lower the barrier for business users.

## 9. Appendix

### 9.1 Glossary

ODS, DWD, DWS and ADS stand for staging, detail, summary and application — the four layers.

### 9.2 References

An index of internal specification documents and public industry material.

#### 9.2.1 Internal Documents

Modelling standards, naming standards and quality standards.

#### 9.2.2 External Material

Public papers and write-ups on lakehouse and data mesh.

### 9.3 Change Log

| Date | Version | Change | Owner |
| --- | --- | --- | --- |
| 2026-08-19 | v1.2 | Added the cost governance chapter | Zhang San |
| 2026-06-01 | v1.1 | Revised storage choices | Li Si |
| 2026-03-15 | v1.0 | First release | Zhang San |

---

*This file is an outline-folding test case for Markdown Read. The content is fictitious.*
