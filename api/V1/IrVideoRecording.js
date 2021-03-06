var models = require('../../models');
var formidable = require('formidable');
var config = require('../../config.js');
var knox = require('knox');
var path = require('path');
var util = require('./util');
var passport = require('passport');
require('../../passportConfig')(passport);


module.exports = function(app, baseUrl) {
  var apiUrl = baseUrl + '/irvideorecordings';

  app.post(apiUrl, passport.authenticate(['jwt', 'anonymous'], { session: false }), function(req,
    res) {
    var device = req.user; // passport put the jwt in the user field. But for us it's a device.
    //TODO check that device is valid. Id not redirect to device authentication..

    util.fileAndDataFromPost(req)
      .then(function(result) {
        var file = result.file;
        var data = result.data;
        var messages = [];
        var errorMessages = [];

        // Generate file URL
        var date = util.getDateFromMetadata(data);
        var s3Path = util.s3PathFromDate(date) + path.extname(file.name);

        // Create IR Video Recording and save to database.
        var model = models.IrVideoRecording.build(
          data, {
            fields: models.IrVideoRecording.apiSettableFields // Limit what fields can be set by the user.
          });

        // Add device data to recording.
        if (typeof device != 'undefined') {
          console.log(device.id);
          model.setDataValue('DeviceId', device.id); // From JWT.
          model.setDataValue('GroupId', device.GroupId); // FROM JWT.
          if (typeof device.public == 'boolean')
            model.setDataValue('public', device.public); // From JWT TODO Check if this has been updated.
        } else {
          console.log("No device found");
          model.public = true; //TODO Remove this after add redirect for failed device authentication is added.
        }

        // Save model to database.
        model.save()
          .then(function() { // Successful post.
            messages.push("Thanks for the IR Video Recording!");
            util.handleResponse(res, {
              success: true,
              statusCode: 200,
              messages: messages
            });
          })
          .catch(function(err) { // Upload to database failed.
            util.serverErrorResponse(res, err);
          });

        // Process and upload file.
        util.convertVideo(file)
          .then(function(convertVideo) {
            return util.uploadToS3(convertVideo, s3Path);
          })
          .then(function(res) {
            if (res.statusCode == 200) {
              console.log("Uploaded File.");
              model.uploadFileSuccess(res);  //TODO add
            } else {
              console.log("Upload failed.");
              //model.uploadFileError(res); //TODO add
            }
          })
          .catch(function(err) {
            console.log("Upload error");
            console.log(err);
            //model.uploadFileError(err); //TODO add
          })
      })
      .catch(function(err) { // Erorr with parsing post.
        handleResponse(err);
      })
  });

  /*
    app.put(apiUrl, function(req, res) {
      // TODO check if the user is able to update this model instance.
      // For now anybody can change it....

      // Validate query data.
      models.IrVideoRecording.findOne({ where: { id: req.body.id } })
        .then(function(model) {
          try {
            data = JSON.parse(req.body.data);
            return model.update(data);
          } catch (err) {
            //TODO Throw error here saying couldn't parse data
          }
        })
        .then(function(model) {
          res.status(200).json({ success: true, msg: ["Updated model."] })
        })
        .catch(function(err) {
          res.status(400).json({ success: false, msg: ["Failed to update model."] })
        })
    });
    */

  /*
    app.delete(apiUrl, function(req, res) {
      console.log("Deleteing IR Video Recording.");
      // TODO check if they have permission to do this to the model instance...
      // TODO ceck that there is an ID in the request body.
      // TODO Delete file from S3 server.
      models.IrVideoRecording.findOne({ where: { id: req.body.id } })
        .then(function(model) {
          // TODO Delete file from database.
          return model.destroy();
        })
        .then(function() {
          req.status(200).json({ success: true, msg: "It's gone." })
        })
        .catch(function() {
          res.status(400).json({ success: false, msg: "Failed to delete." })
        })
    });
    */

  /**
   *  Get request for IR Video Recordings.
   *  headers.where,  Sequelize conditions for query,
   *  headres.offset, Query offset.
   *  headers.limit,  Query results limit.
   */
  app.get(apiUrl, passport.authenticate(['jwt', 'anonymous'], { session: false }),
    function(req, res) {
      var queryParams = util.getSequelizeQueryFromHeaders(req);
      // Return HTTP 400 if error when getting query from headers.
      if (queryParams.error) {
        return util.handleResponse(res, {
          success: false,
          statusCode: 400,
          messages: queryParams.errMsgs
        });
      }

      // Check if authorization of a User by JWT failed.
      if (!req.user && req.headers.authorization) {
        //TODO Redirect to login page, note on login page that can can query an anonymous user but will not see recording private to that user.
        //TODO maybe I can set up the anonymous passport to do this?
      }

      // Request was valid. Now quering database.
      models.IrVideoRecording.findAllWithUser(req.user, queryParams)
        .then(function(models) {
          var result = [];
          for (key in models) result.push(models[key].getFrontendFields());
          return util.handleResponse(res, {
            success: true,
            statusCode: 200,
            messages: ["Successful request."],
            result: result
          })
        })
    });
}
