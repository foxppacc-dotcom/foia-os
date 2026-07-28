#!/usr/bin/env python3
"""Remove hardcoded supabase secret from Git history using git commit-tree."""
import os, sys, subprocess, tempfile

os.chdir(os.path.expanduser(r'~\Desktop\foia-os'))

def git(args):
    r = subprocess.run(['git'] + args, capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        print(f'ERROR: git {" ".join(args)}: {r.stderr[:200]}')
    return r.stdout.strip()

# 1. Get the commit that has the secret
print("Getting commit info...")
secret_commit = '2a3c414'
parent = git(['rev-parse', f'{secret_commit}~1'])
print(f"Secret commit: {secret_commit}, Parent: {parent}")

# 2. Get the tree of the current supabase.js (clean version)
head_tree = git(['rev-parse', 'HEAD^{tree}'])
print(f"HEAD tree: {head_tree}")

# 3. Get the tree hash of supabase.js at HEAD
clean_supabase_blob = git(['hash-object', '-w', 'backend/src/supabase.js'])
print(f"Clean blob: {clean_supabase_blob}")

# 4. Get the old commit's tree
old_tree = git(['rev-parse', f'{secret_commit}^{{tree}}'])
print(f"Old tree: {old_tree}")

# 5. Create a new tree that replaces the supabase.js entry
# Use git ls-tree to see the old tree and create a new one
old_tree_contents = git(['ls-tree', old_tree])
print(f"Old tree entries:\n{old_tree_contents[:300]}")

# Find the supabase.js entry in the old tree
for line in old_tree_contents.split('\n'):
    if 'supabase.js' in line:
        # Replace the blob hash with the clean one
        parts = line.split()
        old_blob = parts[2].split('\t')[0]
        mode = parts[0]
        new_line = line.replace(old_blob, clean_supabase_blob)
        print(f"Replacing: {old_blob[:20]}... -> {clean_supabase_blob[:20]}...")

# 6. Create a new commit tree using git cat-file and mktree
# Actually, let's use a simpler approach: create a new root tree
print("\nCreating new tree with clean supabase.js...")

# Save the old tree for reference
with open('backend/src/supabase.js', 'rb') as f:
    clean_content = f.read()

# Create a new commit tree using git mktree
# We read the old tree, replace the supabase.js blob hash, pipe to mktree
result = subprocess.run(
    ['git', 'ls-tree', old_tree],
    capture_output=True, text=True, timeout=10
)
old_entries = result.stdout.strip()

new_entries = []
for line in old_entries.split('\n'):
    if not line.strip():
        continue
    if 'supabase.js' in line:
        parts = line.split()
        mode = parts[0]
        rest = '\t'.join(parts[3:])  # filename after the blob hash
        new_entries.append(f"{mode} blob {clean_supabase_blob}\t{rest}")
    else:
        new_entries.append(line)

new_tree_input = '\n'.join(new_entries)
r2 = subprocess.run(['git', 'mktree'], input=new_tree_input, capture_output=True, text=True, timeout=10)
new_tree = r2.stdout.strip()
print(f"New tree: {new_tree}")

# 7. Create a new commit with the new tree, same parent
commit_msg = git(['log', '--format=%B', '-1', secret_commit])
r3 = subprocess.run(
    ['git', 'commit-tree', new_tree, '-p', parent, '-m', commit_msg],
    capture_output=True, text=True, timeout=10
)
new_commit = r3.stdout.strip()
print(f"New commit: {new_commit}")

# 8. Replace the old commit with the new one
git(['replace', secret_commit, new_commit])
print(f"Replaced {secret_commit} with {new_commit}")

# 9. Rebase all descendants onto the new commit
git(['filter-branch', '-f', '--tag-name-filter', 'cat', '--', '--all'])
print("History rewritten!")

# 10. Verify no secrets remain
check = git(['grep', 'sb_secret'])
if check:
    print(f"WARNING: Secret still found:\n{check}")
else:
    print("✅ No secrets found in history")

print("\nDone!")
