---
name: rails-audit
description: Perform comprehensive code audits of Ruby on Rails applications based on thoughtbot best practices. Use this skill when the user requests a code audit, code review, quality assessment, or analysis of a Rails application. The skill analyzes the entire codebase focusing on testing practices (RSpec), security vulnerabilities, code design (skinny controllers, domain models, PORO with ActiveModel), Rails conventions, database optimization, and Ruby best practices. Outputs a detailed markdown audit report grouped by category (Testing, Security, Models, Controllers, Code Design, Views) with severity levels (Critical, High, Medium, Low) within each category.
allowed-tools: Read, Grep, Glob
compatibility:
  repo: "*"
metadata:
  author: thoughtbot (adapted by RoleModel Software)
  version: 1.0.0
license: MIT
---

# Rails Audit Skill (thoughtbot Best Practices)

Perform comprehensive Ruby on Rails application audits based on thoughtbot's Ruby Science and Testing Rails best practices, with emphasis on Plain Old Ruby Objects (POROs) over Service Objects.

## Execution Flow

### Step 1: Determine Scope

Ask user or infer from request:
- Full audit: Analyze all of `app/`, `spec/` or `test/`, `config/`, `db/`, `lib/`
- Targeted audit: Analyze specified paths only

Check for `.rails-audit-ignore.yml` at the project root — see `references/ignore_file.md` for format and matching rules.

### Step 2: Collect Optional Metrics (SimpleCov + RubyCritic)

Ask the user **both questions upfront** in a single `AskUserQuestion` so they can decide once:
- **Question**: "Before starting the audit, would you like to collect automated metrics?\n\n1. **SimpleCov** — runs your test suite to capture actual code coverage percentages\n2. **RubyCritic** — analyzes code complexity, duplication, and smells (does not run tests)\n\nBoth are recommended for the most thorough audit."
- **Options**: "Yes to both (Recommended)" / "SimpleCov only" / "RubyCritic only" / "Skip both"

Based on the user's choice, spawn the accepted subagents **in parallel** using the Task tool. Both can run at the same time because SimpleCov modifies the test helper while RubyCritic only reads source files — they don't conflict.

**SimpleCov subagent** (if accepted):

> Read the file `agents/simplecov_agent.md` and follow all steps described in it. The audit scope is: {{SCOPE from Step 1}}. Return the coverage data in the output format specified in that file.

**RubyCritic subagent** (if accepted):

> Read the file `agents/rubycritic_agent.md` and follow all steps described in it. The audit scope is: {{SCOPE from Step 1}}. Return the code quality data in the output format specified in that file.

After both finish, clean up: `rm -rf coverage/` and/or `rm -rf tmp/rubycritic/` as applicable.

**Interpreting responses:**
- `COVERAGE_FAILED` / `RUBYCRITIC_FAILED`: no data for that tool — use estimation mode (SimpleCov) or omit the section (RubyCritic). Note the failure reason in the report.
- `COVERAGE_DATA`: parse and keep in context for Steps 4 and 5 (overall coverage, per-directory breakdowns, lowest-coverage files, zero-coverage files).
- `RUBYCRITIC_DATA`: parse and keep in context for Steps 4 and 5 (overall score, per-directory ratings, worst-rated files, top smells, most complex files).

### Step 3: Load Reference Materials

Before analyzing, read the relevant reference files:
- `references/code_smells.md` - Code smell patterns to identify
- `references/ruby_testing_guidelines.md` - Ruby testing best practices
- `references/javascript_testing_guidelines.md` - Javascript testing best practices
- `references/poro_patterns.md` - PORO and ActiveModel patterns
- `references/security_checklist.md` - Security vulnerability patterns
- `references/rails_antipatterns.md` - Rails-specific antipatterns (external services, migrations, performance)
- `references/stimulus_patterns.md` - Stimulus controller patterns and anti-patterns (betterstimulus.com)
- `references/javascript_code_smells.md` - JavaScript/TypeScript code smells (callback hell, god modules, magic numbers, etc.)
- `references/javascript_antipatterns.md` - JavaScript/TypeScript runtime anti-patterns (memory leaks, eval, innerHTML, layout thrashing, etc.)

### Step 4: Analyze Code by Category

1. **Testing Coverage & Quality** — missing test files, untested public methods, Four Phase Test structure, testing antipatterns; use SimpleCov data for actual coverage if available
2. **Security Vulnerabilities** — SQL injection, mass assignment, XSS, auth/authz issues, sensitive data exposure
3. **Models & Database** — fat models, missing validations, N+1 risks, callback complexity, Law of Demeter violations; flag RubyCritic D/F-rated models
4. **Controllers** — fat controllers, business logic, missing strong parameters, non-RESTful actions, bloated sessions; flag RubyCritic D/F-rated controllers
5. **Code Design & Architecture** — Service Objects → PORO refactoring, large classes, long methods, Feature Envy, SRP violations; cross-reference RubyCritic worst-rated files
6. **Views & Presenters** — logic in views (PHPitis), missing partials, helper complexity, query logic in views, Stimulus SRP violations, missing `disconnect()` cleanup
7. **External Services & Error Handling** — missing exception handling for HTTP calls, missing timeouts, synchronous calls that should be backgrounded, bare rescue, silent failures
8. **JavaScript Code Smells** (`app/javascript/`, `app/assets/javascripts/`) — callback hell, unhandled promise rejections, `==` vs `===`, `var` usage, magic numbers/strings, long functions, god modules; see `references/javascript_code_smells.md`
9. **JavaScript Anti-Patterns** — global variable pollution, memory leaks, `eval()` (Critical), `innerHTML` with unsanitized content (Critical), layout thrashing, swallowed errors; see `references/javascript_antipatterns.md`
10. **Database & Migrations** — messy migrations, missing indexes on foreign keys / polymorphic associations / uniqueness validations, Ruby iteration vs SQL, bulk ops without transactions

### Step 5: Generate Audit Report

Create `RAILS_AUDIT_REPORT.md` in project root with structure defined in `references/report_template.md`.

When SimpleCov coverage data was collected in Step 2, use the **SimpleCov variant** of the Testing section in the report template. When coverage data is not available, use the **estimation variant**.

When RubyCritic data was collected in Step 2, include the **Code Quality Metrics** section in the report using the RubyCritic variant from the report template. When RubyCritic data is not available, use the **not available variant**.

## Severity Definitions

| Level | Meaning |
|-------|---------|
| **Critical** | Security vulnerabilities, data loss risks, production-breaking issues |
| **High** | Performance issues, missing tests for critical paths, major code smells |
| **Medium** | Code smells, convention violations, maintainability concerns |
| **Low** | Style issues, minor improvements, suggestions |

- **Find Ruby files by type**: Use the Glob tool with patterns like `app/models/**/*.rb`, `app/controllers/**/*.rb`, `app/services/**/*.rb`
- **Find test files**: Use Glob with `spec/**/*_spec.rb` or `test/**/*_test.rb`
- **Search for patterns in code**: Use the Grep tool (e.g., search for `rescue\s*$`, `\.save\b`, `params\.permit!`)
- **Read and count lines in files**: Use the Read tool to inspect files; count lines from the output
- **Find long files**: Use Glob to list all `app/**/*.rb` files, then Read each to check line count

## Report Output

Always save the audit report to `RAILS_AUDIT_REPORT.md` in the project root and present it to the user.
