import { APIGatewayProxyHandler } from "aws-lambda";
import axios from "axios";
import debug from "debug";
import * as moment from "moment";
import { readFileSync } from "fs";
import "source-map-support/register";

const logError = debug("ghas:error");

const GitHubEndpoint = "https://api.github.com/graphql";

interface Emoji {
  emoji: string;
  name: string;
}

interface Config {
  token: string;
  emojis: Emoji[];
  messages: string[];
  busy: boolean;
}

function loadConfig(): Config | null {
  try {
    let configBytes = readFileSync(".config.json", "utf8");
    return JSON.parse(configBytes.toString());
  } catch (error) {
    logError(error);
    return null;
  }
}

function getYearProgress() {
  const yearStart = moment().startOf("year");
  const yearEnd = moment().endOf("year");
  return moment().diff(yearStart) / yearEnd.diff(yearStart);
}

function buildProgressBar(progress: number, length: number = 10) {
  // ██░░░░░░░░ XX%
  let progressLength = Math.round(length * progress);
  let trackLength = length - progressLength;
  let track = Buffer.concat([
    Buffer.alloc(progressLength * 3, "█"),
    Buffer.alloc(trackLength * 3, "░")
  ]);
  progress = 100 * progress;
  const precision = progress < 1 ? 2 : 0;
  return `${track.toString()} ${progress.toFixed(precision)}%`;
}

async function queryUserStatus() {
  let query = `
        query {
            viewer {
                status { emoji, emojiHTML, message, indicatesLimitedAvailability }
            }
        }
        `;
  const response = await axios.post(GitHubEndpoint, {
    query
  });
  const result = response.data;
  return result.data.viewer.status;
}

async function mutateUserStatus(
  emoji: Emoji,
  message: string,
  busy: boolean
): Promise<any> {
  const input = `
    emoji: ":${emoji.name}:",
    message: "${message}",
    limitedAvailability: ${busy.toString()}
  `;

  let query = `
          mutation {
              changeUserStatus(input:{${input}}) {
                status { id }
              }
          }
          `;
  let response = await axios.post(GitHubEndpoint, {
    query
  });
  return response.data;
}

async function getIndex(config: Config) {
  const status = await queryUserStatus();
  return (
    config.emojis.findIndex(emoji => `:${emoji.name}:` === status.emoji) || 0
  );
}

async function setNextStatus(config: Config) {
  let index = await getIndex(config);
  index = index + 1;

  const message = `${
    config.messages[index % config.messages.length]
  } ${buildProgressBar(getYearProgress())}`;

  return await mutateUserStatus(
    config.emojis[index % config.emojis.length],
    message,
    config.busy
  );
}

async function updateStatus() {
  const config = loadConfig();
  axios.defaults.headers.common["Authorization"] = `bearer ${config.token}`;
  return await setNextStatus(config);
}

export const test = () => updateStatus().then(console.log);

export const update: APIGatewayProxyHandler = async (event, _context) => {
  await updateStatus();
  return {
    statusCode: 200,
    body: JSON.stringify(
      {
        message: "Status Updated",
        input: event
      },
      null,
      2
    )
  };
};
