/* becodeorg/cli
 *
 * /src/commands/generate/env.js - Generate Command: env type (docker-compose generation)
 *
 * coded by leny@BeCode
 * started at 08/11/2018
 */

import path from "path";
import fs from "fs";
import {promisify} from "util";
import childProcess from "child_process";
import {select, multiselect, confirm} from "enquirer";
import chalk from "chalk";
import {stringify} from "json2yaml";
import mkdir from "make-dir";

import {getGitRoot} from "../../core/utils";
import reporter from "../../core/reporter";

const exec = promisify(childProcess.exec);

const data = require("../../../data/env.json");

const CUSTOM_ENV = "Custom environment";
const DB_NONE = "None";
const DOC_PATH = path.resolve(__dirname, "../../../data/env");
const REMOVE_FLAG = "---REMOVEME---";
const REMOVE_FLAG_MATCHER = /\"---REMOVEME---\"/gi;

export default async function(cmd) {
    let targetPath,
        docContent = [],
        services = [],
        foldersToCreate = [],
        postCommands = [],
        composeConfig = {
            version: "3",
            services: {},
        };

    if (cmd.output && (targetPath = path.resolve(process.cwd(), cmd.output))) {
        if (!fs.existsSync(targetPath)) {
            return reporter.error(
                `Given output path (${chalk.yellow(
                    targetPath,
                )}) doesn't exists!`,
            );
        }
        if (!fs.statSync(targetPath).isDirectory()) {
            return reporter.error(
                `Given output path (${chalk.yellow(
                    targetPath,
                )}) isn't a directory!`,
            );
        }
    } else if (!(targetPath = await getGitRoot())) {
        return reporter.error(
            `You're not in a ${chalk.cyan("git")} repository!`,
        );
    }

    reporter.log(
        `Welcome to ${chalk.cyan(
            "env generator",
        )}. Answer the following questions to generate a ${chalk.yellow(
            "docker-compose",
        )} environment for your project.`,
    );

    const app = await select({
        name: "app",
        message: `Choose a preset for an ${chalk.yellow(
            "app",
        )}, or build your ${chalk.yellow("custom environment")}:`,
        choices: [CUSTOM_ENV, ...Object.keys(data.apps)],
        initial: CUSTOM_ENV,
    });

    if (app !== CUSTOM_ENV) {
        services.push(...data.apps[app]);
    } else {
        const langage = await select({
            name: "langage",
            message: `Choose your ${chalk.yellow("langage")}:`,
            choices: Object.keys(data.langages),
        });

        services.push(langage);

        const database = await select({
            name: "database",
            message: `Choose your ${chalk.yellow("database")}:`,
            choices: [DB_NONE, ...Object.keys(data.databases)],
            initial: DB_NONE,
        });

        database !== DB_NONE && services.push(database);

        const tools = await multiselect({
            name: "tools",
            message: `Choose your ${chalk.yellow("tool(s)")}:`,
            choices: [
                ...(database === DB_NONE ? [] : data.databases[database]),
                ...data.tools,
            ],
            initial: [],
        });

        tools.length && services.push(...tools);
    }

    services.forEach(key => {
        const {
            name,
            service,
            commands,
            documentation,
            volumes,
            folders,
        } = data.services[key];

        composeConfig.services[name] = service;

        if (Array.isArray(volumes)) {
            if (!composeConfig.volumes) {
                composeConfig.volumes = {};
            }
            volumes.forEach(volume => {
                composeConfig.volumes[volume] = REMOVE_FLAG;
            });
        }

        docContent.push(
            fs.readFileSync(path.join(DOC_PATH, documentation), "utf8"),
        );

        Array.isArray(folders) && foldersToCreate.push(...folders);

        Array.isArray(commands) && postCommands.push(...commands);
    });

    const composePath = path.resolve(targetPath, "docker-compose.yml");
    const docPath = path.resolve(targetPath, "docker-readme.md");

    if (fs.existsSync(composePath) || fs.existsSync(docPath)) {
        const override = await confirm({
            name: "override",
            message: `You already have a ${chalk.yellow(
                "docker-compose.yml",
            )} file in this ${
                cmd.output ? "folder" : "repository"
            }! Will you ${chalk.bold.red("replace")} it?`,
            initial: false,
        });

        if (!override) {
            return reporter.log("Aborted.");
        }
    }

    fs.writeFileSync(
        composePath,
        stringify(composeConfig).replace(REMOVE_FLAG_MATCHER, ""),
        "utf8",
    );
    fs.writeFileSync(
        docPath,
        `${fs.readFileSync(
            path.join(DOC_PATH, "base.md"),
            "utf8",
        )}\n${docContent.join("\n* * *\n\n")}`,
        "utf8",
    );

    if (foldersToCreate.length) {
        reporter.log(`Creating ${chalk.cyan("binded volumes")} folders…`);

        await Promise.all(
            foldersToCreate.map(async folder => await mkdir(folder)),
        );
    }

    if (postCommands.length) {
        reporter.log(
            `Running ${chalk.yellow(postCommands.length)} ${chalk.cyan(
                "post commands",
            )}…`,
        );

        await Promise.all(
            postCommands.map(async postCommand => {
                const {stdout, stderr} = await exec(postCommand, {
                    log: false,
                    cwd: process.cwd(),
                });

                stderr && reporter.error(stderr);

                reporter.log(stdout);
            }),
        );
    }

    reporter.success(
        `Your ${chalk.yellow("docker-compose.yml")} file has been created!`,
        `Check the ${chalk.yellow(
            "docker-readme.md",
        )} file for more informations.`,
    );
}
