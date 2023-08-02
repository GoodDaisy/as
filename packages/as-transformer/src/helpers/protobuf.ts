import { spawnSync } from 'child_process';
import { ASType, ProtoType, fetchCustomTypes } from './customTypeParser.js';
import { MassaExport } from '../transformers/massaExport.js';
import { Update, UpdateType } from '../transformers/interfaces/Update.js';
import * as fs from 'fs';
import yaml from 'yaml';

function readRefTable(): Map<ASType, ProtoType> {
  const file = fs.readFileSync('./reftable.yml').toString();
  let parsed = yaml.parse(file);

  let initial: Map<ASType, ProtoType> = new Map();
  for (const t of parsed) {
    initial.set(t.as, { name: t.proto, repeated: t.repeated });
  }
  let customs: Map<ASType, ProtoType> = fetchCustomTypes();
  let table = new Map([...initial.entries(), ...customs.entries()]);
  return table;
}

export class Argument {
  private name: string;
  private type: string;
  private fnName: string;

  constructor(name: string, type: string, fnName: string) {
    this.name = name;
    this.type = type;
    this.fnName = fnName;
  }

  getName(): string {
    return this.name;
  }

  getType(): string {
    return this.type;
  }

  getFnName(): string {
    return this.fnName;
  }
}

/**
 * Generates the protobuf file data for the passed function signature.
 *
 * @remarks
 * The protobuf file is written with the proto3 syntax.
 *
 * @see [proto3](https://protobuf.dev/programming-guides/proto3/)
 *
 * @param name - The name of the function.
 * @param args - The arguments of the function.
 * @param returnedType - The return type of the function.
 *
 * @returns the protobuf file as a string.
 */
export function generateProtoFile(
  name: string,
  args: Argument[],
  returnedType: string | undefined,
  transformer: MassaExport,
): string {
  // NOTE: this is called only once atm
  // if it not the case anymore move this to the upper call
  let refTable = readRefTable();

  const argumentMessages = args.map((arg, index) => {
    let typeInfo = refTable.get(arg.getType())!;
    let fieldName = arg.getName();
    let message = generatePayload(fieldName, typeInfo, index + 1);
    if (typeInfo.metaData !== null && typeInfo.metaData !== undefined) {
      pushCustomTypeUpdate(transformer, arg.getFnName(), typeInfo);
    }
    return message;
  });
  const fields = argumentMessages.join('\n');

  // FIXME: Q'n D to unblock the cli:
  let customImports = `
import "google/protobuf/descriptor.proto";

extend google.protobuf.FieldOptions {
optional string custom_type = 50002;
}
`;

  let imports = fields.indexOf('custom_type') > -1 ? customImports : '';

  let protoFile = `
syntax = "proto3";
${imports}
message ${name}Helper {
${fields}
}`;

  if (returnedType && returnedType != 'void' && returnedType != 'null') {
    const argumentResponse: Argument = new Argument(
      'value',
      returnedType,
      name,
    );

    let typeInfo = refTable.get(argumentResponse.getType())!;
    let fieldName = argumentResponse.getName();
    const response = generatePayload(fieldName, typeInfo, 1);
    if (typeInfo.metaData !== null && typeInfo.metaData !== undefined) {
      pushCustomTypeUpdate(transformer, argumentResponse.getFnName(), typeInfo);
    }

    protoFile += `

message ${name}RHelper {
${response}
}`;
  }

  return protoFile;
}

function pushCustomTypeUpdate(
  transformer: MassaExport,
  functionName: string,
  type: ProtoType,
) {
  transformer.updates.push(
    new Update(
      UpdateType.Argument,
      type.name,
      new Map([
        ['type', [type.name]],
        ['ser', [type.metaData!.serialize]],
        ['deser', [type.metaData!.deserialize]],
        ['fnName', [functionName]],
      ]),
      'custom-proto',
    ),
  );
}

/**
 *
 * @remarks
 * The protobuf argument is written with the proto3 syntax.
 * @see [proto3](https://protobuf.dev/programming-guides/proto3/)
 *
 * @returns the protobuf argument as a string.
 */
function generatePayload(
  field: string,
  proto: ProtoType,
  index: number,
): string {
  const fieldType = (proto.repeated ? 'repeated ' : '') + proto.name;
  const optTemplateType =
    proto.metaData !== null && proto.metaData !== undefined
      ? ` [(custom_type) = "${proto.name}"];`
      : ';';
  return `  ${fieldType} ${field} = ${index}` + optTemplateType;
}

/**
 * Generates the AS helpers functions for the passed protobuf file.
 *
 * @remarks
 * The AS helpers code is generated using the as-proto-gen plugin with protoc compiler.
 * These generated functions are used to call the smart contract functions without having to pre-serialize the data.
 *
 * @param protoFile - The data of the protobuf file.
 * @param outputPath - The path to write the generated code to.
 */
export function generateASHelpers(protoFile: string, outputPath: string): void {
  let protocProcess = spawnSync('protoc', [
    `--plugin=protoc-gen-as=./node_modules/.bin/as-proto-gen`,
    `--as_out=${outputPath}`,
    `--as_opt=gen-helper-methods`,
    `--proto_path=./build`,
    protoFile,
  ]);

  if (protocProcess.status !== 0) {
    console.error(
      `Failed to generate AS helpers code for: \n${protoFile} \nwith error: ${protocProcess.stderr}`,
    );
  }
}
