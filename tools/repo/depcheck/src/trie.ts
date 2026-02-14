export interface ITrieNode {
    children: Map<string, ITrieNode>;
    isEndOfWord: boolean;
}

class TrieNode implements ITrieNode {
    id: string;
    children: Map<string, ITrieNode>;
    isEndOfWord: boolean;
    services: string[];

    constructor(id: string) {
        this.children = new Map();
        this.isEndOfWord = false;
        this.id = id;
        this.services = [];
    }
}

export class Trie {
    private root: TrieNode;

    constructor() {
        this.root = new TrieNode('/');
    }

    insert(path: string, service: string) {
        let currentNode = this.root;
        for (const word of path.split('/')) {
            if (!currentNode.children.has(word)) {
                currentNode.children.set(word, new TrieNode(word));
            }
            currentNode = currentNode.children.get(word) as TrieNode;
        }
        currentNode.isEndOfWord = true;
        currentNode.services.push(service);
    }

    print() {
        this.printHelper(this.root, '', true);
    }

    private printHelper(node: ITrieNode, prefix: string, isLast: boolean) {
        if (node !== this.root) {
            let n = node as TrieNode;
            console.log(
                `${prefix}${isLast ? '└── ' : '├── '}${node.isEndOfWord ? '*' : ''}${n.id} ${
                    n.services.length > 0 ? `(${n.services.join(', ')})` : ''
                }`,
            );
        } else {
            console.log((node as TrieNode).id);
        }

        const childPrefix = node === this.root ? '' : `${prefix}${isLast ? '    ' : '│   '}`;

        const children = Array.from(node.children.entries());

        children.forEach(([_, childNode], index) => {
            const isLastChild = index === children.length - 1;
            this.printHelper(childNode, childPrefix, isLastChild);
        });
    }
}

// const test = () => {
//     const trie = new Trie();
//     trie.insert('a/b/c', 'foo');
//     trie.insert('a/b/d', 'foo');
//     trie.insert('a/b/e', 'foo');
//     trie.insert('a/b/f', 'foo');
//     trie.insert('a/b/g', 'foo');
//     trie.insert('a/b/g', 'foo');
//     trie.insert('a/c/r', 'foo');
//     trie.insert('a/c/t', 'foo');
//     trie.insert('a/c/y', 'foo');
//     trie.insert('a/c/x', 'foo');
//     trie.insert('a/c/w', 'foo');
//     trie.insert('a/b/v', 'foo');
//     trie.insert('a/x/u', 'foo');
//     trie.insert('a/x/s', 'foo');
//     trie.insert('a/x/q', 'foo');
//     trie.insert('a/x/u/r', 'foo');
//     trie.insert('a/x/u/x', 'foo');
//     trie.insert('a/x/u/r/m/n', 'foo');
//     trie.insert('a/x/u/t', 'foo');
//     trie.insert('a/x/s/s', 'foo');
//     trie.insert('a/x/q/m', 'foo');

//     trie.print();
// };

// test()
