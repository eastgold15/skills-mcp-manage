import { scopeDir } from "../core/paths";
import { diagnose } from "../core/view";
import { colors } from "../ui/colors";
import { printTable } from "../ui/prompts";

/**
 * 诊断作用域目录的真实构成。
 *
 * 「作用域不清」的痛点本质是看不见谁指向哪里 ——
 * 这个命令就是把它摊开：我们管的、外部工具建的、拷进来的副本。
 */
export async function doctor(projectPath: string): Promise<void> {
  const reports = await diagnose(projectPath);

  for (const report of reports) {
    const label = report.scope === "global" ? "全局" : "项目";
    const dir = scopeDir(report.scope, projectPath);

    console.log("");
    console.log(colors.bold(`${label}作用域  ${colors.gray(dir)}`));

    if (report.entries.length === 0) {
      console.log(colors.gray("  （空）"));
      continue;
    }

    const rows = report.entries.map((entry) => {
      if (entry.kind === "managed") {
        return [entry.id, colors.success("已纳管"), colors.gray("→ 本体库")];
      }
      if (entry.kind === "external") {
        return [
          entry.id,
          colors.warning("外部"),
          colors.gray(`→ ${entry.target ?? "?"}`),
        ];
      }
      return [
        entry.id,
        colors.warning("副本"),
        colors.gray("真实目录，非链接"),
      ];
    });

    printTable(["ID", "形态", "指向"], rows);

    const { managed, external, directory } = report.counts;
    console.log(
      colors.gray(`  已纳管 ${managed} · 外部 ${external} · 副本 ${directory}`)
    );

    if (external > 0) {
      console.log(
        colors.gray("  外部链接由其他工具建立，本工具不会修改或删除它们")
      );
    }
    if (directory > 0) {
      console.log(
        colors.gray(
          "  副本是拷贝进来的目录，不随本体库更新；如需纳管请先手动移除"
        )
      );
    }
  }

  console.log("");
}
