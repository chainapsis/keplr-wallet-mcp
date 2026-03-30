import "zx/globals";
import fs from "fs";
import semver from "semver";

const lernaFile = fs.readFileSync("./lerna.json", "utf8");
const lerna = JSON.parse(lernaFile);

(async () => {
  try {
    const versions = (await $`git tag --points-at HEAD`).stdout
      .split(/\s/)
      .map((v) => v.trim())
      .filter((v) => !!v);

    let foundedVersion = "";

    for (const version of versions) {
      const semantic = semver.parse(version);

      if (semantic) {
        if (lerna.version !== semantic.version) {
          console.log(
            `WARNING: ${semantic.version} found. But, it is different from lerna's package version.`,
          );
          continue;
        }

        if (foundedVersion) {
          console.log(
            `WARNING: ${foundedVersion} already published. Only one tag can be published at once.`,
          );
          continue;
        }

        foundedVersion = version;

        const isPrerelease = semantic.prerelease.length > 0;

        if (isPrerelease) {
          await $`lerna publish from-package --yes --dist-tag next`;
        } else {
          await $`lerna publish from-package --yes`;
        }
      }
    }

    if (foundedVersion) {
      console.log(`${foundedVersion} published to NPM`);

      console.log(`Try to create the release ${foundedVersion}`);

      const semantic = semver.parse(foundedVersion);
      if (semantic) {
        const isPrerelease = semantic.prerelease.length > 0;

        if (isPrerelease) {
          await $`gh release create ${foundedVersion} -t ${foundedVersion} --prerelease --generate-notes`;
        } else {
          await $`gh release create ${foundedVersion} -t ${foundedVersion} --generate-notes`;
        }

        console.log("Release created");
      } else {
        throw new Error("Unexpected error");
      }
    } else {
      throw new Error("No version tag found");
    }
  } catch (e) {
    console.log(e);
    process.exit(1);
  }
})();
