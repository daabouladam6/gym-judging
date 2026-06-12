# Why the repo was not on GitHub yet

Creating or pushing to **your** GitHub account requires **you** to sign in (browser or token). Automated tools cannot complete `gh auth login` for you, so the push step stopped until you authenticate once.

# Create the GitHub repository and push (recommended)

1. **Install GitHub CLI** (if needed): [GitHub CLI](https://cli.github.com/) — you already have it if `gh` works in PowerShell.

2. **Log in once** (opens browser):

   ```powershell
   & "$env:ProgramFiles\GitHub CLI\gh.exe" auth login
   ```

3. **From this folder** (`judging app`), run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\publish-to-github.ps1
   ```

   Or, if scripts are allowed:

   ```powershell
   .\scripts\publish-to-github.ps1
   ```

   By default this creates a **private** repo named **`gym-judging`** and pushes `main`.

   **Custom name** (if `gym-judging` is taken):

   ```powershell
   .\scripts\publish-to-github.ps1 -RepoName "my-judging-app"
   ```

4. Open the printed URL in your browser — the code should be there. You can then point **Fly.io** at this GitHub repo for deploys.

# Alternative: GitHub website + Git

1. On GitHub: **New repository** → name it (e.g. `gym-judging`) → **no** README / .gitignore (empty repo).
2. In PowerShell, from this folder:

   ```powershell
   git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git
   git push -u origin main
   ```

   Replace `YOUR_USERNAME` and `REPO_NAME`. Use a **Personal Access Token** as the password if prompted, or sign in via **GitHub Desktop**.
