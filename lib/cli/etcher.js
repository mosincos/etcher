/*
 * Copyright 2016 resin.io
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const Bluebird = require('bluebird');
const listDrives = Bluebird.promisify(require('drivelist').list);
const imageStream = require('etcher-image-stream');
const _ = require('lodash');
const isElevated = Bluebird.promisify(require('is-elevated'));
const visuals = require('resin-cli-visuals');

const options = require('./cli');
const driveSelectionWidget = require('./drive-selection-widget');
const utils = require('./utils');
const writer = require('./writer');

const EXIT_CODES = require('../shared/exit-codes');

isElevated().then((elevated) => {
  if (!elevated) {
    throw new Error('This should should be run with root/administrator permissions');
  }
  return Bluebird.props({
    imageMetadata: imageStream.getImageMetadata(options._[0]),
    drives: listDrives()
  });
}).then((results) => {
  const imageMetadata = results.imageMetadata;
  const drives = results.drives;

  if (options.drive) {
    return _.find(drives, {
      device: options.drive
    });
  }

  const confirmationRequired = !options.robot && !options.yes;
  return driveSelectionWidget(drives, confirmationRequired, imageMetadata);
}).then((selectedDrive) => {
  const progressBars = {
    write: new visuals.Progress('Flashing'),
    check: new visuals.Progress('Validating')
  };

  return writer.writeImage(options._[0], selectedDrive, {
    unmountOnSuccess: options.unmount,
    validateWriteOnSuccess: options.check
  }, (state) => {

    if (options.robot) {
      console.log(JSON.stringify({
        command: 'progress',
        data: {
          type: state.type,
          percentage: Math.floor(state.percentage),
          eta: state.eta,
          speed: Math.floor(state.speed)
        }
      }));
    } else {
      progressBars[state.type].update(state);
    }

  });
}).then((results) => {

  return Bluebird.try(() => {
    if (options.robot) {
      return console.log(JSON.stringify({
        command: 'done',
        data: {
          sourceChecksum: results.sourceChecksum
        }
      }));
    }

    console.log('Your flash is complete!');

    if (results.sourceChecksum) {
      console.log(`Checksum: ${results.sourceChecksum}`);
    }

  }).then(() => {
    process.exit(EXIT_CODES.SUCCESS);
  });

}).catch((error) => {

  return Bluebird.try(() => {
    if (options.robot) {
      return console.error(JSON.stringify({
        command: 'error',
        data: {
          message: error.message,
          description: error.description,
          stacktrace: error.stack,
          code: error.code
        }
      }));
    }

    utils.printError(error);
  }).then(() => {
    if (error.code === 'EVALIDATION') {
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }

    process.exit(EXIT_CODES.GENERAL_ERROR);
  });

});
