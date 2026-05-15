class Gtom < Formula
  desc "Cognitive defense and Theory of Mind system"
  homepage "https://github.com/ch1kim0n1/GToM"
  url "https://github.com/ch1kim0n1/GToM/archive/refs/tags/gtom-v0.1.0.tar.gz"
  sha256 "REPLACE_WITH_RELEASE_TARBALL_SHA256"
  license "MIT"

  depends_on "node@20"
  depends_on "python@3.12" => :build

  def install
    system "npm", "ci"
    system "npm", "rebuild", "better-sqlite3"
    system "npm", "run", "build"
    libexec.install Dir["*"]
    bin.install_symlink libexec/"dist/cli.js" => "gtom"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/gtom version-info --json")
  end
end
