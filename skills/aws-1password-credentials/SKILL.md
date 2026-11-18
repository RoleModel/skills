---
name: aws-1password-credentials
description: >-
  Set up the AWS CLI and AWS SDKs to read access keys from 1Password at run
  time, so no AWS secret is stored on disk. Installs a credential_process helper
  and adds one profile per 1Password API Credential item. Use when someone asks
  to set up an AWS profile, add AWS keys to their machine, stop keeping keys in
  ~/.aws/credentials, use 1Password with the AWS CLI, or rotate a key they use
  locally. Also use to check that a new key works, without changing anything
  in AWS.
allowed-tools: Bash Read Edit Write
compatibility: Designed for Claude Code (or similar products). Needs macOS or Linux, the 1Password app and CLI, jq, and AWS CLI v2.
metadata:
  author: rolemodel
  version: "1.0"
  triggers: "aws profile, aws credentials, aws keys, 1password aws, op aws, credential_process, ~/.aws/config, ~/.aws/credentials, rotate aws key, test aws key"
license: MIT
---

# AWS keys from 1Password

The AWS CLI and every AWS SDK can run a program to get keys, through the
`credential_process` setting in `~/.aws/config`. This skill installs a small
helper program, `op-aws-creds`, that reads the keys from 1Password each time.
The secret key is never written to disk.

`<this skill>` below means the folder this SKILL.md is in.

## How a 1Password item must look

The helper finds items by **key name**, not by title. Each AWS key needs one
item that has all of these:

- **Category:** API Credential.
- **Key name:** the profile name, for example `acme-prod`. The 1Password app
  shows this built-in field as "key name"; the `op` CLI calls it `username`.
- **Two fields with exactly these labels:** `Access Key ID`, holding the key
  ID, and `Secret Access Key`, holding the secret key. The helper ignores the
  built-in `credential` field.
- **Vault:** `Shared`, unless you name another vault in the profile (step 3).

Exactly one item in the vault may have each key name. If two have the same
name, the helper stops with an error rather than guess.

## Set up

1. Check the tools. Install what is missing (`brew install 1password-cli jq awscli`):

   ```bash
   op --version && jq --version && aws --version
   ```

   `aws --version` must start with `aws-cli/2`. In the 1Password app, turn on
   **Settings → Developer → Integrate with 1Password CLI**.

2. Install the helper at a fixed path. `credential_process` needs a full path,
   and a path inside this skill would change when the skill moves.

   ```bash
   mkdir -p ~/.aws
   install -m 755 <this skill>/scripts/op-aws-creds ~/.aws/op-aws-creds
   ```

   If `~/.aws/op-aws-creds` already exists, `diff` it with the new copy, and
   ask the user before you replace it.

3. Add one profile per key to `~/.aws/config`. Create the file if it does not
   exist. Write the full home path: `credential_process` does not understand `~`.

   ```ini
   [profile acme-prod]
   credential_process = /Users/<you>/.aws/op-aws-creds acme-prod
   region = us-east-1
   ```

   - If the item is not in `Shared`, add the vault name after the key name.
     Quote a name with spaces:
     `credential_process = /Users/<you>/.aws/op-aws-creds acme-prod "Acme Keys"`.
   - Put `region` in every profile. A profile does not take settings from
     `[default]`.
   - If `~/.aws/credentials` has an old copy of the same profile, remove it.
     Otherwise the AWS CLI keeps using those plain keys and never asks 1Password.

4. Test each profile. This changes nothing in AWS, and needs no permissions:

   ```bash
   aws sts get-caller-identity --profile acme-prod --query Arn --output text
   ```

   It must print the ARN of the IAM user you expect.

To rotate a key later, put the new values in the two fields of the 1Password
item, then run step 4 again. Nothing else changes.

## Keep secrets out of the conversation

- Never print a secret key or the helper's output. To check the helper, print
  only the names of its fields: `~/.aws/op-aws-creds acme-prod | jq 'keys'`.
- To check that two copies of a secret match, for example after a rotation,
  compare short hashes instead of the values:
  `<command that prints the secret> | shasum -a 256 | cut -c1-12`.

## When something fails

| What you see | What to do |
| --- | --- |
| `found 0` | No item in that vault has that key name. Check the key name, the vault, and that the item's category is API Credential. Check that you can see the item in 1Password. |
| `found 2` (or more) | Two items share a key name. Rename or archive one. |
| `op` asks you to sign in, or hangs | Unlock 1Password. Check that the CLI setting in step 1 is on. |
| The first command after unlocking takes about 10 seconds | Normal. Each later command takes about 2 seconds, because every `aws` command asks 1Password again. |
| `aws` uses the wrong key when you leave out `--profile` | Something gives `aws` other keys. Run `env \| cut -d= -f1 \| grep '^AWS_'` to list names without values, and unset credential overrides such as `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` if present. Run `type aws`: if it is a function or alias, a 1Password shell plugin is passing its own keys, so remove the line that loads it from your shell profile. |

## Why not the 1Password shell plugin

`op plugin init aws` wraps the `aws` command in a shell function, so only an
interactive shell sees it. Scripts that call `aws` and code that uses an AWS SDK
(Ruby, Terraform, Python) get no keys from it. `credential_process` works for
all of them.
